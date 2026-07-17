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
      pref       - standing user preferences ("never auto-send to investors")
      thread     - durable summary of a long email thread (so we don't re-read it)

CLI (stable contract — agents call these via Bash)
--------------------------------------------------
  add     --kind K --key NAME --text "FACT" [--source URL] [--weight 1.0]
  recall  --kind K [--query "..."] [--key NAME] [--k 6] [--max-chars 1200]
  list    [--kind K] [--limit 50]
  forget  --id N            |  --kind K --key NAME
  stats
  doctor                    - first-run preflight: checks python3/uvx/OAuth env/store

`recall` is the hot path: returns compact JSON the agent drops straight into
context. `--max-chars` hard-caps the payload so a recall can never blow a budget.

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


DB_PATH = _db_path()
_LEGACY_DB = Path(__file__).with_name("memory.db")  # pre-2026-07 location, inside the clone


def _migrate_legacy():
    """One-time lift of a profile from the old in-clone location. Sidecars included —
    WAL's -wal/-shm hold real data, so moving only the .db can lose recent writes."""
    if DB_PATH.exists() or not _LEGACY_DB.exists():
        return
    import shutil
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    for suffix in ("", "-wal", "-shm"):
        src = Path(str(_LEGACY_DB) + suffix)
        if src.exists():
            shutil.move(str(src), str(Path(str(DB_PATH) + suffix)))  # shutil: may cross devices
    print(f"[rahu] moved your learned profile out of the repo → {DB_PATH}", file=sys.stderr)

# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #

def _conn():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    # busy_timeout + WAL so the workflow fan-out (parallel()/pipeline() spawns many
    # agents that each `store.py add` at once) doesn't hit "database is locked".
    c = sqlite3.connect(DB_PATH, timeout=5.0)
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
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
    return c


# --------------------------------------------------------------------------- #
# optional semantic layer (graceful fallback to keyword scoring)
# --------------------------------------------------------------------------- #

_MODEL = None

def _embed(text):
    """Return a list[float] embedding, or None if sentence-transformers absent."""
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


def cmd_add(a):
    if len(a.text) > MAX_FACT_CHARS:
        a.text = a.text[: MAX_FACT_CHARS - 1].rstrip() + "…"
    emb = _embed(a.text) if a.kind in ("voice", "tagging", "contact", "deal", "thread") else None
    with _conn() as c:
        c.execute(
            """
            INSERT INTO facts(kind,key,text,source,weight,updated,embedding)
            VALUES(?,?,?,?,?,?,?)
            ON CONFLICT(kind,key) DO UPDATE SET
                text=excluded.text, source=excluded.source,
                weight=excluded.weight, updated=excluded.updated,
                embedding=excluded.embedding
            """,
            (a.kind, a.key, a.text, a.source, a.weight, time.time(),
             json.dumps(emb) if emb else None),
        )
    print(json.dumps({"ok": True, "kind": a.kind, "key": a.key}))


def cmd_recall(a):
    with _conn() as c:
        rows = c.execute(
            "SELECT id,kind,key,text,source,weight,updated,embedding FROM facts WHERE kind=?",
            (a.kind,),
        ).fetchall() if a.kind else c.execute(
            "SELECT id,kind,key,text,source,weight,updated,embedding FROM facts"
        ).fetchall()

    if a.key:
        rows = [r for r in rows if r[2] == a.key]

    scored = []
    qemb = _embed(a.query) if a.query else None
    for r in rows:
        _id, kind, key, text, source, weight, updated, emb = r
        if a.query:
            if qemb and emb:
                s = _cosine(qemb, json.loads(emb))
            else:
                s = _keyword_score(a.query, text)
        else:
            s = 0.0
        # blend relevance with the fact's own weight + a gentle recency nudge
        recency = 1.0 / (1.0 + (time.time() - updated) / 86400.0 / 30.0)  # ~month half-life
        scored.append((s * 2 + weight * 0.3 + recency * 0.2, r))

    scored.sort(key=lambda x: x[0], reverse=True)

    out, used = [], 0
    for _, r in scored[: a.k]:
        _id, kind, key, text, source, weight, updated, _ = r
        budget = a.max_chars - used - len(key)
        if budget <= 0:
            break
        # Hard cap: never let a single fat fact blow the budget — truncate the
        # first/oversized fact to fit rather than emit it whole (the old `and out`
        # let the first fact exceed max_chars unconditionally).
        if len(text) > budget:
            text = text[: max(0, budget - 1)].rstrip() + "…"
        chunk = {"id": _id, "kind": kind, "key": key, "text": text}
        if source:
            chunk["source"] = source
        used += len(text) + len(key)
        out.append(chunk)
    print(json.dumps({"facts": out, "chars": used, "semantic": bool(qemb)}, ensure_ascii=False))


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
        chk(False, "memory store writable", f"{e} — check permissions on {DB_PATH.parent}",
            core_blockers)
    if store_ok:
        chk(True, f"memory store writable ({DB_PATH})")
    chk(n > 0, f"learned profile ({n} facts)",
        "run /learn first — it builds your profile from your OWN Gmail")

    print("\nFull Google Workspace path (.mcp.json — Gmail+Calendar+Tasks+Drive+Docs)")
    print("  Skip this section if you're using the hosted Gmail connector via /mcp.")
    uvx = shutil.which("uvx")
    chk(bool(uvx), f"uvx {'→ ' + uvx if uvx else 'NOT FOUND'}",
        "install uv (it provides uvx):  curl -LsSf https://astral.sh/uv/install.sh | sh",
        workspace_gaps)
    for v in ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET", "USER_GOOGLE_EMAIL"):
        chk(bool(os.environ.get(v)), f"${v}",
            f"export {v}=...   (Google Cloud Console → Credentials → OAuth desktop client)",
            workspace_gaps)

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

    d = sub.add_parser("doctor"); d.set_defaults(fn=cmd_doctor)

    args = p.parse_args()
    _migrate_legacy()  # before any _conn(), or an empty new DB would mask the old one
    args.fn(args)


if __name__ == "__main__":
    main()
