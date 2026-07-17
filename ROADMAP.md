# RAHU — Roadmap

Improvements identified in the 2026-07-09 system audit. The **critical** batch is shipped;
the rest is ordered by leverage.

## ✅ Shipped (this batch)
- **Documented path now matches the code.** Repo-root `.mcp.json` wires the self-hosted
  `workspace-mcp` (Gmail + Calendar + Tasks + Drive + Docs) — Claude Code auto-detects it,
  and its `mcp__google-workspace__*` tool names are exactly what the agents, permissions,
  and send-guard already reference.
- **Send-safety latch hardened.** `settings.example.json` PreToolUse matcher is now a regex
  that fires for any Gmail send tool (self-hosted *and* the hosted connector), not one exact name.
- **Concurrency-safe memory store.** `store.py` uses WAL + `busy_timeout` so the parallel
  workflow fan-out can't hit `database is locked`.
- **Autopilot no longer re-drafts the same mail.** A per-user memory watermark + the
  processed-label marker mean each message is handled once; the drafter skips threads that
  already have a RAHU draft.
- **Hard recall budget** (a single fat fact can no longer blow `--max-chars`) and a
  **`--text` size cap** (`MAX_FACT_CHARS`) enforcing "distilled patterns, never raw bodies."
- **Bootstrap is now honest.** A repo can only ship the MCP *recipe*, never the server
  itself — so `uv`/`uvx` is documented as an explicit prerequisite (its absence made the
  `.mcp.json` server fail with a bare "command not found"), the timezone is no longer
  hardcoded to `Asia/Kolkata` (`${WORKSPACE_MCP_DEFAULT_TIMEZONE:-UTC}`), and
  **`/doctor`** (`store.py doctor`) preflights python3 / store / `uvx` / OAuth vars and
  never reports "ready" while the Google server can't actually start.
- **The learned profile survives the repo.** It used to live inside the clone, so a
  re-clone or `git clean -xdf` silently destroyed a profile that cost real mail to build.
  Now at `~/.rahu/memory.db` (override: `RAHU_MEMORY_DB`, e.g. to share one profile across
  clones), with a one-time cross-device migration that lifts any existing profile out —
  WAL sidecars included, since moving only the `.db` can drop recent writes.

## 🟠 High — correctness & intelligence
- **Learn from corrections.** Periodic pass that diffs "label RAHU applied" vs "label now on
  the thread"; when the user overrode RAHU, write a correcting `tagging` fact. Biggest
  accuracy win — closes the loop beyond the one-time `/learn`.
- **Semantic recall is slow per-call.** `all-MiniLM-L6-v2` cold-loads on every `store.py`
  invocation (fresh process). Move embeddings to an offline "reindex" step or a persistent
  socket server; keep keyword mode as the fast default.
- **Wire the dead `thread` kind.** `store.py` documents/embeds durable thread summaries but
  nothing writes them — the exact mechanism that would stop re-reading long deal/vendor
  threads. Have `deal-context` and `catchup` persist them.

## 🟡 Medium — features & trust
- **Confidence threshold / review queue.** Hold low-confidence labels under a
  `RAHU/needs-review` label instead of applying, so trust builds gradually.
- **Audit log + undo.** Record every applied label change (msg-id, +/- label) to a dated
  Google Doc or a `memory` audit kind → enables "undo last labeling run."
- **Evening briefing.** The skill promises Morning/Evening but only a morning workflow +
  one `/briefing` exist. Add an evening variant (shipped / still-open) or drop the claim.
- **Metrics.** Weekly "N labeled, M drafts, K accepted" line from the audit log — shows
  whether RAHU is actually helping and where it's wrong.
- **Confirm model IDs.** `settings.example.json` pins `claude-sonnet-4-6`; re-check against
  current IDs (Opus 4.8 / Sonnet 5 / Haiku 4.5) and set triage→Haiku, memos→Opus explicitly.

## 🟢 Low — polish & onboarding
- **Wire `/doctor` into `/learn` and `/label`** as an automatic preflight, so a broken
  setup is reported before the first confusing tool failure rather than after.
- **Windows-native portability.** Hooks are `.sh` (fine in WSL); ship `.cmd` equivalents or
  note the requirement for native-Windows users of the public repo.
- **Smoke test** for the workflows with a mock agent, to catch schema drift beyond
  `node --check`.
