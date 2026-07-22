#!/usr/bin/env python3
"""
Local, open-source, token-efficient memory store  ("supermemory"-style).
=========================================================================

Why this exists
---------------
Agents must know the *user's* context — writing voice, tagging conventions,
contacts, deals — WITHOUT re-reading whole email threads every run (expensive,
token-heavy). This store keeps a small set of *distilled facts* and returns only
the few relevant to the current task. That is the whole token-efficiency trick:
retrieve K compact facts, not N raw emails.

Design
------
* Pure local. One SQLite file, kept OUTSIDE the repo clone at `~/.rahu/memory.db`
  (override: `RAHU_MEMORY_DB`) so a re-clone or `git clean` can't wipe a profile that
  took real mail to build. No server, no SaaS, no API key.
* Inspired by the open-source `supermemory` project (supermemoryai/supermemory)
  but reduced to a single file so it runs anywhere `python3` exists.
* Semantic recall via `sentence-transformers` IF installed; otherwise a
  deterministic keyword/recency fallback. Either way the CLI contract is stable.
* Facts are namespaced by `kind` so each agent pulls only its slice:
      voice      - the user's writing-style profile (greetings, sign-offs, tone)
      tagging    - learned Gmail-label rules ("invoices -> Finance/Invoices")
      contact    - per-person facts (role, relationship, last topic)
      deal       - CRM / pipeline / IC-memo context
      pref       - standing user preferences ("never auto-send to investors").
                   USER-FACING: injected into every session as "Standing prefs" by
                   session-start-inject-memory.sh, so keep machine bookkeeping OUT of it.
      thread     - durable summary of a long email thread (so we don't re-read it)
      labelmap   - the user's learned label STRUCTURE (which group is pick-one)
      cursor     - internal bookkeeping (e.g. autopilot:watermark). Deliberately its own
                   kind: it used to squat in `pref`, where it was surfaced to every agent
                   as if it were a standing user preference.

CLI (stable contract — agents call these via Bash)
--------------------------------------------------
  add      --kind K --key NAME --text "FACT" [--source URL] [--weight 1.0]
  recall   --kind K [--query "..."] [--key NAME] [--k 6] [--max-chars 1200]
  list     [--kind K] [--limit 50]
  forget   --id N            |  --kind K --key NAME
  stats
  reindex                    - compute embeddings for rows still missing one
  doctor                    - first-run preflight: checks python3/uvx/OAuth env/store

`recall` is the hot path: returns compact JSON the agent drops straight into
context. `--max-chars` hard-caps the payload so a recall can never blow a budget.

Embeddings are NOT computed at `add` time on purpose: loading the
sentence-transformers model costs ~2-5s and hundreds of MB, and the workflow
fan-out does many `add`s at once — paying that per write would be brutal. So
`add` stays model-free and leaves `embedding` NULL; a single `reindex` run loads
the model once and back-fills every NULL row. Until then (or with the lib
absent) `recall` transparently uses the keyword/recency fallback.

All writes are idempotent on (kind,key): re-adding the same key UPDATES the fact
(so the "dynamic, learned-from-email-trails" profile stays fresh, not duplicated).
"""

import argparse
import json
import os
import sqlite3
import sys
import time
from pathlib import Path

def _db_path():
    """Where the learned profile lives.

    NOT inside the repo clone: the profile is expensive to build (/learn reads your
    real mail) and must survive a re-clone, a moved folder, or `git clean -xdf`.
    Override with RAHU_MEMORY_DB to relocate or to share one profile across clones.
    """
    env = os.environ.get("RAHU_MEMORY_DB")
    return Path(env).expanduser() if env else Path.home() / ".rahu" / "memory.db"


# Resolved LAZILY (via _db_path()) on every _conn()/main() call, NOT frozen at import:
# a caller that sets RAHU_MEMORY_DB after this module loads (tests, embedded use) must
# still be honored, and the same process may target different DBs across calls.
_LEGACY_DB = Path(__file__).with_name("memory.db")  # pre-2026-07 location, inside the clone


def _migrate_legacy():
    """One-time lift of a profile from the old in-clone location. Sidecars included —
    WAL's -wal/-shm hold real data, so moving only the .db can lose recent writes."""
    db = _db_path()
    if db.exists() or not _LEGACY_DB.exists():
        return
    import shutil
    db.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        src = Path(str(_LEGACY_DB) + suffix)
        if src.exists():
            shutil.move(str(src), str(Path(str(db) + suffix)))  # shutil: may cross devices
    print(f"[rahu] moved your learned profile out of the repo → {db}", file=sys.stderr)

# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #

# Bump this when the schema changes AND add a matching `if v < N:` block in
# _migrate_schema(). The DB lives at ~/.rahu/memory.db and outlives repo clones, so
# every migration must be safe to run against a DB that already holds real facts.
SCHEMA_VERSION = 1


def _migrate_schema(c):
    """`PRAGMA user_version` migration scaffold.

    user_version 0 = an *unversioned* DB: either brand-new, or one written before this
    versioning existed (which already has the `facts` table from the old
    CREATE-on-connect). Migrations run in order from the DB's current version up to
    SCHEMA_VERSION; each step is guarded by IF NOT EXISTS so it's idempotent and never
    clobbers existing data. To evolve the schema later: bump SCHEMA_VERSION and append a
    new `if v < N:` block — do NOT edit a migration that has already shipped.
    """
    v = c.execute("PRAGMA user_version").fetchone()[0]
    if v >= SCHEMA_VERSION:
        return
    if v < 1:
        # v0 -> v1: baseline schema. IF NOT EXISTS makes this a no-op DDL on legacy DBs
        # that already carry the table, so their rows survive the version bump untouched.
        c.execute(
            """
            CREATE TABLE IF NOT EXISTS facts (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                kind      TEXT NOT NULL,
                key       TEXT NOT NULL,
                text      TEXT NOT NULL,
                source    TEXT,
                weight    REAL DEFAULT 1.0,
                updated   REAL NOT NULL,
                embedding TEXT,                      -- json float list, or NULL
                UNIQUE(kind, key)
            )
            """
        )
        c.execute("CREATE INDEX IF NOT EXISTS idx_kind ON facts(kind)")
    # (future) if v < 2: c.execute("ALTER TABLE facts ADD COLUMN ...")
    c.execute(f"PRAGMA user_version={SCHEMA_VERSION}")  # PRAGMA can't bind params; int is ours
    c.commit()  # persist the bump + DDL even for otherwise read-only callers


def _conn():
    db = _db_path()  # resolved per call so a late-set RAHU_MEMORY_DB is honored
    db.parent.mkdir(parents=True, exist_ok=True)
    # busy_timeout + WAL so the workflow fan-out (parallel()/pipeline() spawns many
    # agents that each `store.py add` at once) doesn't hit "database is locked".
    c = sqlite3.connect(db, timeout=5.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    _migrate_schema(c)
    return c


# --------------------------------------------------------------------------- #
# optional semantic layer (graceful fallback to keyword scoring)
# --------------------------------------------------------------------------- #

# Kinds worth embedding for semantic recall. Bookkeeping kinds (cursor), standing
# prefs, and label STRUCTURE are excluded — they're matched by kind/key, not by meaning.
EMBED_KINDS = ("voice", "tagging", "contact", "deal", "thread")

_MODEL = None

def _embed(text):
    """Return a list[float] embedding, or None if sentence-transformers is absent.

    Guarded by _semantic_available() FIRST so the (~2-5s, hundreds-of-MB) model is never
    even reached for on a machine without the lib. The model is memoised in _MODEL, but
    that memo is per-process: only paths that genuinely need it (recall --query, reindex)
    call this — everything else stays model-free."""
    if not _semantic_available():
        return None
    global _MODEL
    try:
        if _MODEL is None:
            from sentence_transformers import SentenceTransformer  # type: ignore
            _MODEL = SentenceTransformer("all-MiniLM-L6-v2")
        return [float(x) for x in _MODEL.encode(text, normalize_embeddings=True)]
    except Exception:
        return None


def _semantic_available():
    """Is sentence-transformers importable? Checked WITHOUT loading the model."""
    import importlib.util
    return importlib.util.find_spec("sentence_transformers") is not None


def _cosine(a, b):
    return sum(x * y for x, y in zip(a, b))


def _keyword_score(query, text):
    """Deterministic fallback: token overlap, lightly length-normalised."""
    q = {w for w in query.lower().split() if len(w) > 2}
    if not q:
        return 0.0
    t = text.lower()
    hits = sum(1 for w in q if w in t)
    return hits / len(q)


# --------------------------------------------------------------------------- #
# commands
# --------------------------------------------------------------------------- #

MAX_FACT_CHARS = 2000  # facts are DISTILLED patterns, not raw email bodies — enforce it.
WEIGHT_MAX = 3.0        # --weight is blended (s*2 + weight*0.3 + ...); unbounded weight
                        # lets one fact bury relevance, so clamp it to [0, WEIGHT_MAX].


def cmd_add(a):
    if len(a.text) > MAX_FACT_CHARS:
        a.text = a.text[: MAX_FACT_CHARS - 1].rstrip() + "…"
    if not (0.0 <= a.weight <= WEIGHT_MAX):
        clamped = min(WEIGHT_MAX, max(0.0, a.weight))
        print(f"[rahu] --weight {a.weight} out of [0, {WEIGHT_MAX}] — clamped to {clamped}",
              file=sys.stderr)
        a.weight = clamped
    # NOTE: no embedding computed here on purpose — `add` stays model-free (see module
    # docstring). Insert embedding NULL; `reindex` back-fills it. On an UPDATE we keep the
    # existing embedding only if the text is unchanged, else NULL it so it gets recomputed.
    with _conn() as c:
        c.execute(
            """
            INSERT INTO facts(kind,key,text,source,weight,updated,embedding)
            VALUES(?,?,?,?,?,?,NULL)
            ON CONFLICT(kind,key) DO UPDATE SET
                text=excluded.text, source=excluded.source,
                weight=excluded.weight, updated=excluded.updated,
                embedding=CASE WHEN facts.text=excluded.text THEN facts.embedding ELSE NULL END
            """,
            (a.kind, a.key, a.text, a.source, a.weight, time.time()),
        )
    print(json.dumps({"ok": True, "kind": a.kind, "key": a.key}))


def cmd_recall(a):
    # Filter in SQL (kind AND/OR key), not in Python: no reason to SELECT the whole table
    # and drop rows afterwards — the WHERE does it in one pass and returns only what we need.
    where, params = [], []
    if a.kind:
        where.append("kind=?"); params.append(a.kind)
    if a.key:
        where.append("key=?"); params.append(a.key)
    q = "SELECT id,kind,key,text,source,weight,updated,embedding FROM facts"
    if where:
        q += " WHERE " + " AND ".join(where)
    with _conn() as c:
        rows = c.execute(q, params).fetchall()

    scored = []
    # Only reach for the model when there's a query AND the lib is present; otherwise
    # qemb stays None and every row falls through to the keyword/recency fallback.
    qemb = _embed(a.query) if a.query else None
    semantic_used = False  # true ONLY if cosine actually scored against a stored embedding
    for r in rows:
        _id, kind, key, text, source, weight, updated, emb = r
        if a.query:
            if qemb and emb:
                # cosine ∈ [-1,1] but _keyword_score ∈ [0,1]; they're ranked together, so
                # map cosine to [0,1] via (c+1)/2 before blending — else negatives skew it.
                s = (_cosine(qemb, json.loads(emb)) + 1.0) / 2.0
                semantic_used = True
            else:
                s = _keyword_score(a.query, text)
        else:
            s = 0.0
        # blend relevance with the fact's own weight + a gentle recency nudge
        recency = 1.0 / (1.0 + (time.time() - updated) / 86400.0 / 30.0)  # ~month half-life
        scored.append((s * 2 + weight * 0.3 + recency * 0.2, r))

    scored.sort(key=lambda x: x[0], reverse=True)

    out, used = [], 2  # 2 = the enclosing [] of the facts array, so `used` == its real length
    for _, r in scored[: a.k]:
        _id, kind, key, text, source, weight, updated, _ = r
        # Budget against the SERIALIZED size, envelope included. Counting only
        # text+key under-reported every chunk by the id/kind/source JSON around it,
        # so --max-chars was a soft cap wearing a "hard cap" comment.
        chunk = {"id": _id, "kind": kind, "key": key, "text": ""}
        if source:
            chunk["source"] = source
        overhead = len(json.dumps(chunk, ensure_ascii=False))
        sep = 2 if out else 0  # json.dumps joins list items with ", " — two chars, not one
        budget = a.max_chars - used - overhead - sep
        if budget <= 0:
            break
        if len(text) > budget:  # truncate an oversized fact to fit rather than skip it
            text = text[: max(0, budget - 1)].rstrip() + "…"
        chunk["text"] = text
        used += sep + overhead + len(text)
        out.append(chunk)
    print(json.dumps({"facts": out, "chars": used, "semantic": semantic_used}, ensure_ascii=False))


def cmd_list(a):
    with _conn() as c:
        q = "SELECT id,kind,key,substr(text,1,80),updated FROM facts"
        args = ()
        if a.kind:
            q += " WHERE kind=?"
            args = (a.kind,)
        q += " ORDER BY updated DESC LIMIT ?"
        rows = c.execute(q, args + (a.limit,)).fetchall()
    for r in rows:
        print(f"[{r[0]:>4}] {r[1]:<8} {r[2]:<28} {r[3]}")


def cmd_forget(a):
    with _conn() as c:
        if a.id:
            c.execute("DELETE FROM facts WHERE id=?", (a.id,))
        elif a.kind and a.key:
            c.execute("DELETE FROM facts WHERE kind=? AND key=?", (a.kind, a.key))
        else:
            sys.exit("forget needs --id OR (--kind AND --key)")
    print(json.dumps({"ok": True}))


def cmd_stats(a):
    with _conn() as c:
        rows = c.execute("SELECT kind,COUNT(*) FROM facts GROUP BY kind").fetchall()
        total = c.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
    print(json.dumps({"total": total, "by_kind": dict(rows),
                      "semantic_available": _semantic_available()}))


def cmd_reindex(a):
    """Back-fill embeddings for embeddable rows that don't have one yet.

    Two jobs in one: (1) the primary indexing pass — `add` leaves `embedding` NULL, so
    this is what actually makes semantic recall work; (2) the repair path — before this
    existed, a transient embed failure left a row NULL forever with no way to retry.
    Loads the model ONCE for the whole batch. Degrades gracefully (clear message, exit 0)
    when sentence-transformers isn't installed — keyword recall needs no embeddings."""
    if not _semantic_available():
        print("reindex: sentence-transformers not installed — nothing to do. "
              "Recall uses the keyword/recency fallback, which needs no embeddings.")
        sys.exit(0)
    placeholders = ",".join("?" * len(EMBED_KINDS))
    fixed, skipped = 0, 0
    with _conn() as c:
        rows = c.execute(
            f"SELECT id,text FROM facts WHERE embedding IS NULL AND kind IN ({placeholders})",
            EMBED_KINDS,
        ).fetchall()
        for _id, text in rows:
            emb = _embed(text)
            if emb:
                c.execute("UPDATE facts SET embedding=? WHERE id=?", (json.dumps(emb), _id))
                fixed += 1
            else:
                skipped += 1  # embed returned None (e.g. model load failed) — retryable later
    print(json.dumps({"ok": True, "fixed": fixed, "skipped": skipped,
                      "candidates": fixed + skipped}))


def cmd_doctor(a):
    """First-run preflight. Catches the confusing failures BEFORE the user hits them:
    a missing `uvx` (the .mcp.json server can't start), unset OAuth vars (it starts but
    can't authenticate), an unwritable store, or an un-learned profile."""
    import shutil

    core_blockers, workspace_gaps = [], []

    def chk(passed, label, hint=None, bucket=None):
        if not passed and bucket is not None:
            bucket.append(label)
        print(f"  {'✓' if passed else '✗'} {label}")
        if not passed and hint:
            print(f"      → {hint}")

    print("RAHU doctor\n")

    db = _db_path()
    print("Core (always required)")
    chk(sys.version_info >= (3, 8), f"python3 {sys.version.split()[0]}",
        "RAHU needs Python 3.8+", core_blockers)
    try:
        with _conn() as c:
            c.execute("SELECT 1")
            n = c.execute("SELECT COUNT(*) FROM facts").fetchone()[0]
        store_ok = True
    except Exception as e:
        store_ok, n = False, 0
        chk(False, "memory store writable", f"{e} — check permissions on {db.parent}",
            core_blockers)
    if store_ok:
        chk(True, f"memory store writable ({db})")
    chk(n > 0, f"learned profile ({n} facts)",
        "run /learn first — it builds your profile from your OWN Gmail")

    print("\nFull Google Workspace path (.mcp.json — Gmail+Calendar+Tasks+Drive+Docs)")
    # Two ways to connect Google — this section only checks the self-hosted one:
    print("  There are two ways to connect Google; this section checks the self-hosted path:")
    print("    · self-hosted workspace-mcp   — FULL: Gmail+Calendar+Tasks+Drive+Docs;")
    print("                                    needs uvx + OAuth env (checked below).")
    print("    · claude.ai-hosted connectors — zero-setup via /mcp, but Gmail/Calendar/Drive")
    print("                                    only (no Tasks). Skip this section if you use it.")
    uvx = shutil.which("uvx")
    chk(bool(uvx), f"uvx {'→ ' + uvx if uvx else 'NOT FOUND'}",
        "install uv (it provides uvx):  curl -LsSf https://astral.sh/uv/install.sh | sh",
        workspace_gaps)
    for v in ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "USER_GOOGLE_EMAIL"):
        chk(bool(os.environ.get(v)), f"${v}",
            f"export {v}=...   (Google Cloud Console → Credentials → OAuth desktop client)",
            workspace_gaps)

    print("\nSafety")
    settings = Path(__file__).resolve().parents[1] / "settings.json"
    chk(settings.exists(), f"send-guard registered ({settings.name})",
        "the send-latch lives in settings.example.json and is INERT until you copy it:\n"
        "        cp .claude/settings.example.json .claude/settings.json\n"
        "      Until then nothing in RAHU blocks a send — only Claude Code's own prompting.")

    print("\nOptional")
    print(f"  · semantic recall: {'available' if _semantic_available() else 'off — keyword fallback (fine, and faster per call)'}")
    tz = os.environ.get("WORKSPACE_MCP_DEFAULT_TIMEZONE")
    print(f"  · timezone: {tz or 'unset → server defaults to UTC (export WORKSPACE_MCP_DEFAULT_TIMEZONE=Asia/Kolkata to change)'}")

    print()
    if core_blockers:
        print("NOT READY — fix the ✗ items under Core above, then re-run this.")
    elif workspace_gaps:
        print("Core is fine, but the .mcp.json Google server is INCOMPLETE:")
        print(f"  missing: {', '.join(workspace_gaps)}")
        print("  → finish those for the full experience (Tasks/Docs, /briefing, /memo), OR")
        print("  → run /mcp and pick the hosted Gmail connector — zero setup, but")
        print("    labeling + drafting only (no Tasks/Docs).")
    elif n == 0:
        print("Environment is ready. Next: run /learn, then /label.")
    else:
        print("All good — you're ready. Try /label dry-run.")
    sys.exit(1 if core_blockers else 0)


def main():
    p = argparse.ArgumentParser(prog="memory")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add"); a.add_argument("--kind", required=True)
    a.add_argument("--key", required=True); a.add_argument("--text", required=True)
    a.add_argument("--source"); a.add_argument("--weight", type=float, default=1.0)
    a.set_defaults(fn=cmd_add)

    r = sub.add_parser("recall"); r.add_argument("--kind"); r.add_argument("--query")
    r.add_argument("--key"); r.add_argument("--k", type=int, default=6)
    r.add_argument("--max-chars", type=int, default=1200, dest="max_chars")
    r.set_defaults(fn=cmd_recall)

    l = sub.add_parser("list"); l.add_argument("--kind"); l.add_argument("--limit", type=int, default=50)
    l.set_defaults(fn=cmd_list)

    f = sub.add_parser("forget"); f.add_argument("--id", type=int)
    f.add_argument("--kind"); f.add_argument("--key"); f.set_defaults(fn=cmd_forget)

    s = sub.add_parser("stats"); s.set_defaults(fn=cmd_stats)

    ri = sub.add_parser("reindex"); ri.set_defaults(fn=cmd_reindex)

    d = sub.add_parser("doctor"); d.set_defaults(fn=cmd_doctor)

    args = p.parse_args()
    _migrate_legacy()  # before any _conn(), or an empty new DB would mask the old one
    args.fn(args)


if __name__ == "__main__":
    main()
