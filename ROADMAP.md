# RAHU — Roadmap

## ⚠️ Correction (2026-07-22 batch)

The biggest finding of this batch outranks everything below: **every Google tool name in
the repo was fictional.** All 11 names (`gmail_list_messages`, `gmail_create_draft`,
`docs_create`, `tasks_insert`, `drive_search`, …) matched *neither* the self-hosted
`workspace-mcp` server (real: `search_gmail_messages`, `draft_gmail_message`,
`create_doc`, `manage_task`, `search_drive_files`, …) *nor* the claude.ai-hosted
connectors — so every agent had **zero working Google tools on both paths**, and the
send-guard matcher, fixed twice before, was dead a **third** time (it didn't match the
real `send_gmail_message`). Root cause: names were guessed instead of verified.

Fixed by: source-verifying the workspace names from the `workspace-mcp==1.22.0` wheel
(now version-pinned in `.mcp.json`), discovering the hosted names post-OAuth, recording
both families in **`TOOLNAMES.md`** (the standing rule: never reference a Google tool
that isn't in that file), rewriting every agent grant, permission entry, skill mention,
and the guard matcher (matcher unit-tested against real positives *and* negatives).

Silver lining: the real server *has* the tools three "impossible" features needed —
`list_gmail_labels` (dynamic labeling), `manage_event` (/prep can write the Calendar
event), `search_docs`/`modify_doc_text` (real briefing-Doc dedup). All now granted.
Also discovered: hosted Gmail has **no send tool** (draft-only by construction) and no
Tasks connector (action items fall back to a Doc checklist or draft on that path).

## ✅ Shipped (2026-07-22 performance batch, 13 units)

- **Dual-connector rewire** — all agents, permissions, and skills wired for both the
  pinned workspace-mcp and the hosted connectors; send-guard matcher fixed + tested.
- **Query-side cursors** — /autopilot and /catchup push their watermark into the Gmail
  query (`after:<epoch>`), so a looped run stops re-reading the whole window every pass.
- **Poison-message cap** — a message that fails drafting 3× is skipped and logged instead
  of blocking the cursor forever (with stale-failcount eviction on later success).
- **Voice hoist** — voice facts are recalled once per pass and injected into every draft
  prompt instead of N identical per-drafter recalls.
- **Briefing hardened** — settle() isolation (one failed draft no longer kills the tasks,
  preps, and the Doc), whole-message truncation (no more mid-JSON slicing), a
  `briefing:lastrun` cursor, search-then-update Doc dedup, and a real Opus re-draft pass
  for flagged high-stakes drafts (`voice-drafter-opus`).
- **learn-voice settle** — one failed learner no longer discards the other's work.
- **store.py** — `PRAGMA user_version` schema migrations; embeddings moved out of `add`
  into an offline `reindex` subcommand (no more per-invocation model cold-loads, NULL
  embeddings repairable); cosine normalized before blending; `semantic` reported honestly;
  `--key` filter pushed into SQL; `--weight` clamped; DB path honored at call time.
- **Correction loop** — `/recalibrate` diffs applied-vs-current labels and refines the
  learned `tagging` rules; **audit trail** — every applied label writes a distilled
  `audit` fact; **/stats** reads it back as a 7-day report.
- **Session hook** — injects the (actually-written) `labelmap` instead of the dead `pref`
  kind; **preflights** — /learn runs doctor automatically, /label warns when
  `settings.json` (allowlist + send-latch) is missing.
- **Mock workflow harness** (`tests/mock-workflow-harness.mjs`) — dry-runs any workflow
  with scripted fake agents; used to verify all of the above control flow.

(Earlier shipped batches and their corrections are preserved in git history — see the
2026-07-09 and 2026-07-17 entries in prior revisions of this file.)

## 🟠 High
- **Live end-to-end validation.** This batch was verified with CLI + mock-harness tests
  only (no Google account on the dev machine). First session on a real inbox:
  `/doctor` → `/learn` → `/label dry-run` → `/label`, then `/catchup` twice (assert no
  duplicate drafts) and `/briefing` twice (assert one Doc). Real hosted tool *behavior*
  (arg shapes, thread vs message granularity) may still surprise where names no longer can.
- **Confidence threshold / review queue.** Hold low-confidence labels under a
  `RAHU/needs-review` label instead of applying, so trust builds gradually.

## 🟡 Medium
- **Undo.** The audit trail now exists; add "undo last labeling run" on top of it.
- **Evening briefing** is threaded through (`mode`) but the workflow is still named
  `rahu-morning-briefing` and the evening content ordering (what shipped / what's open)
  isn't specialized. Finish + rename.
- **Hosted draft-dedup.** Hosted Gmail exposes `list_drafts` (the workspace server has no
  equivalent granted); voice-drafter could skip threads that already carry a RAHU draft
  on that path.

## 🟢 Low
- **Windows-native portability.** Hooks are `.sh` (fine in WSL); ship `.cmd` equivalents
  or note the requirement for native-Windows users.
- **Prune stale Dimension references** — Dimension.dev wound down 2026-05-20; the
  comparisons in skills/workflows still read as if it were live.
