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
* Pure local. One SQLite file (`memory.db`). No server, no SaaS, no API key.
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

DB_PATH = Path(__file__).with_name("memory.db")

# --------------------------------------------------------------------------- #
# storage
# --------------------------------------------------------------------------- #

def _conn():
    c = sqlite3.connect(DB_PATH)
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

def cmd_add(a):
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
            "SELECT id,kind,key,text,source,weight,updated,embedding FROM facts WHERE kind=?"
            + ("" if a.kind else ""),
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
        chunk = {"id": _id, "kind": kind, "key": key, "text": text}
        if source:
            chunk["source"] = source
        cost = len(text) + len(key)
        if used + cost > a.max_chars and out:
            break
        used += cost
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
                      "semantic_available": _embed("ping") is not None}))


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

    args = p.parse_args()
    args.fn(args)


if __name__ == "__main__":
    main()
