# RAHU — Roadmap

Improvements identified in the 2026-07-09 system audit. The **critical** batch is shipped;
the rest is ordered by leverage.

## ⚠️ Correction (2026-07-17 audit)

An audit found that several fixes recorded below as "shipped" **did not work**. They are
corrected in the repo now, but the false claims are called out here because a roadmap that
lies is worse than no roadmap:

- **The send-latch never fired.** The "hardened" matcher used `(?i)`, a Python/PCRE inline
  flag that is a **compile error** in JS (`Invalid group`) — Claude Code runs on Node. The
  latch was dead for *every* tool, including its main target. Now
  `([Gg]mail.*[Ss]end|send_email|send_message|gmail_send_message)`, verified to compile and
  to match all three send tools while ignoring `gmail_create_draft`.
- **The latch also failed open**, and still does not fire by default. It shelled to
  `python3` under `set -e`, so on a box without python3 it printed **nothing** and the send
  fell through (verified: exit 127, no output). Rewritten with bash builtins only. Separately
  it is registered only in `settings.example.json` — **inert until you copy it** (see below).
- **The autopilot draft-dedup guard was unexecutable theatre.** It ordered the drafter to
  "check for an existing draft"; `voice-drafter` has no drafts-list tool. Removed; dedup is
  now the cursor + processed marker, which are real.
- **The watermark squatted in `pref`**, which `session-start-inject-memory.sh` injects into
  every session as "Standing prefs" — so an epoch integer was shown to every agent as a
  standing user preference, ranked #1 on a fresh install. Moved to its own `cursor` kind.
- **The watermark advanced before the work it guarded**, so a failed draft phase skipped
  those messages *forever* (silent loss — worse than the duplicates it fixed). It now
  checkpoints only up to the first failure.
- **`Asia/Kolkata` was still hardcoded** in `settings.example.json` — only `.mcp.json` was
  fixed. That whole duplicate `mcpServers` block is now removed.
- **`--max-chars` was a soft cap** wearing a "hard cap" comment: it counted only text+key,
  not the JSON envelope. Now budgeted against serialized size.

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

## 🔴 P0 — blocked on knowing real tool names (do NOT guess these again)

- **No agent can list Gmail labels.** `inbox-triage.md:12`, `email-triage/SKILL.md:13` and
  `memory-curator.md:19` all call `labels.list` "the only source of truth", but **no agent is
  granted any labels-listing tool** and none is in `permissions`. The entire
  "dynamic, zero-hardcoded labels" premise rests on a tool nothing can call. Fix requires the
  real tool name from the connector actually in use.
- **`/prep` cannot write the Calendar event** it advertises (README:72, `prep.md:12`,
  `meeting-prep/SKILL.md:24`). `meeting-prep.md:4` grants read-only calendar tools; no
  calendar-write tool exists anywhere in the repo.
- **`morning-briefing.js:82` duplicates its Doc every run.** `briefing-writer.md:4` has
  `docs_create` but no Drive/Docs search, so it cannot check whether today's fixed-title Doc
  already exists. Needs a search/get tool before the dedup can be real (same class of bug as
  the drafts-list one above — an instruction with no tool behind it).
- **Agents are coupled to one connector family.** All 7 hard-allowlist
  `mcp__google-workspace__*`; on the claude.ai-hosted path every agent has **zero** Google
  tools. Hosted names are undiscoverable until the user authenticates via `/mcp` — that
  authorization is the critical path for this whole section.

## 🟠 High — correctness & intelligence
- **Learn from corrections.** Periodic pass that diffs "label RAHU applied" vs "label now on
  the thread"; when the user overrode RAHU, write a correcting `tagging` fact. Biggest
  accuracy win — closes the loop beyond the one-time `/learn`.
- **Semantic recall is slow per-call.** `all-MiniLM-L6-v2` cold-loads on every `store.py`
  invocation (fresh process). Move embeddings to an offline "reindex" step or a persistent
  socket server; keep keyword mode as the fast default.
- **`pref` is the genuinely dead kind** (this entry previously named `thread`, wrongly —
  `briefing-writer.md:19`, `meeting-prep/SKILL.md:28`, `morning-briefing/SKILL.md:32` all
  write `thread`). Nothing writes `pref`, yet **8 places read it** and the SessionStart hook
  injects it as "Standing prefs" every session. `/learn` should learn real standing prefs
  (retired labels, silent-apply, never-auto-send-to-X) or the reads should be dropped.

## 🟡 Medium — features & trust
- **Confidence threshold / review queue.** Hold low-confidence labels under a
  `RAHU/needs-review` label instead of applying, so trust builds gradually.
- **Audit log + undo.** Record every applied label change (msg-id, +/- label) to a dated
  Google Doc or a `memory` audit kind → enables "undo last labeling run."
- **Evening briefing is half-wired** (this entry previously said it didn't exist):
  `briefing.md:8` parses `evening`, `morning-briefing.js:47,82` thread `MODE` through, and
  `briefing-writer.md:19` honors it. Finish it (evening = what shipped / what's still open)
  and rename the `rahu-morning-briefing` workflow, which is now misleading.
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
