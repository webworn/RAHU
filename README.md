# RAHU — your AI coworker, built entirely on Google + Claude Code

RAHU is a Claude Code-native re-implementation of [Dimension](https://dimension.dev)
(the "AI coworker that never sleeps", wound down May 20 2026). It reproduces
Dimension's feature set **inside the Google ecosystem with no separate UI**: every
output lands as a **Gmail draft/label, a Google Calendar event, a Google Task, or a
Google Doc**. Claude Code is the engine; Google is the interface.

It learns *your* writing voice and *your* tagging conventions from your own email
trails, stores them in a **local, open-source, token-efficient memory** (no SaaS), and
routes each job to the **cheapest Claude model that can do it well**.

---

## What it does (Dimension feature → RAHU implementation)

| Dimension feature | RAHU | Lands in |
|---|---|---|
| Auto email triage — label, prioritize, organize before you open it | `inbox-triage` agent (Haiku) + `email-triage` skill | **Gmail labels** |
| Auto-draft replies in your tone | `voice-drafter` agent (Sonnet) + `draft-in-voice` skill | **Gmail drafts** |
| Morning / Evening Briefing (one screen) | `rahu-morning-briefing` workflow + `briefing-writer` | **Google Doc** + draft-to-self |
| Catch Up — summary + ready draft per message | `rahu-catchup` workflow | **Gmail drafts** |
| Meeting prep & daily recaps | `meeting-prep` agent + skill | **Calendar event** / Doc |
| Action items, all in one place | `action-extractor` agent (Haiku) | **Google Tasks** |
| CRM / deal context + IC memo (VC/founder) | `deal-analyst` agent (Opus) + `deal-context` skill | **Google Doc** + memory |
| Inbox Autopilot (tag + draft every inbound) | `rahu-inbox-autopilot` workflow under `/loop` | **Gmail drafts/labels** |
| Learns your voice + tags from history | `memory-curator` agent + `rahu-learn-voice` workflow | **local memory** |
| 30+ integrations via MCP | one open-source Google Workspace MCP server | Gmail/Cal/Tasks/Drive/Docs |

Feature list verified by deep research against dimension.dev's own pages
(`/email`, `/morning-briefing`, `/vc`, `/founder`, `/pricing`), docs, the founder's
launch post, and Product Hunt (3-0 adversarial verification on each core claim).

---

## Architecture

```
.claude/
├── settings.example.json     # MCP servers, model routing, hooks, permissions — REVIEW then copy to settings.json
├── commands/                 # what you type
│   ├── briefing.md           # /briefing [morning|evening] [window]
│   ├── catchup.md            # /catchup [window]
│   ├── autopilot.md          # /autopilot [since]   (wrap with /loop for always-on)
│   ├── prep.md               # /prep [today|<meeting>]
│   ├── learn.md              # /learn   (refresh voice + tagging memory)
│   └── memo.md               # /memo <company> [memo|brief]
├── workflows/                # multi-agent orchestration (the /workflows)
│   ├── morning-briefing.js   # triage → draft+tasks+prep (parallel) → synthesize Doc
│   ├── catchup.js            # triage → per-message draft (pipelined)
│   ├── inbox-autopilot.js    # one autopilot pass (loop calls it repeatedly)
│   └── learn-voice.js        # learn voice + tagging from email trails
├── agents/                   # specialists, each pinned to a model
│   ├── inbox-triage.md       (haiku)   ├── action-extractor.md (haiku)
│   ├── voice-drafter.md      (sonnet)  ├── briefing-writer.md   (sonnet)
│   ├── meeting-prep.md       (sonnet)  ├── memory-curator.md    (sonnet)
│   └── deal-analyst.md       (opus)
├── skills/                   # the "how" for each capability
│   ├── email-triage/  draft-in-voice/  morning-briefing/  meeting-prep/
│   └── action-items/  deal-context/    voice-memory/
├── hooks/
│   ├── session-start-inject-memory.sh  # cheap context at session start
│   └── pre-send-guard.sh               # never auto-send unless explicitly opted in
└── memory/                   # local supermemory-style store (the user-context brain)
    └── store.py              # SQLite + optional semantic recall, keyword fallback
```

### How a request flows

```
/briefing
   └─ Workflow: rahu-morning-briefing
        ├─ phase Triage    → inbox-triage (Haiku)  reads Gmail, applies labels, returns digest
        ├─ phase Act       → parallel:
        │     ├─ voice-drafter (Sonnet) ×N  → Gmail drafts   (recall voice from memory)
        │     ├─ action-extractor (Haiku)   → Google Tasks
        │     └─ meeting-prep (Sonnet)      → Calendar descriptions
        └─ phase Synthesize→ briefing-writer (Sonnet) → one Google Doc
```

Each agent recalls only the few memory facts it needs (voice, tagging, contact, deal)
— never the whole inbox — which is what keeps token cost low.

---

## The memory store (local, open-source, token-efficient)

`.claude/memory/store.py` is a single-file SQLite store inspired by the open-source
[supermemory](https://github.com/supermemoryai/supermemory) project, reduced so it runs
anywhere `python3` exists — **no server, no API key, nothing leaves your machine.**

* **Namespaced facts** (`voice`, `tagging`, `contact`, `deal`, `pref`, `thread`) so each
  agent pulls only its slice.
* **`recall --query ... --k N --max-chars C`** returns a hard-capped compact JSON blob —
  a recall can never blow your token budget.
* **Semantic recall** via `sentence-transformers` if installed; otherwise a deterministic
  keyword/recency fallback. Same CLI either way.
* **Idempotent** on `(kind,key)` — re-learning updates in place, so the profile stays
  current as your style drifts (the "dynamic" part).

```bash
python3 .claude/memory/store.py recall --kind voice --query "investor reply" --k 4
python3 .claude/memory/store.py add    --kind pref  --key no-lp-autosend --text "Never auto-send to LPs."
python3 .claude/memory/store.py stats
```

Run `/learn` to populate it from your Sent mail + existing Gmail labels.
Optional, for semantic recall: `pip install sentence-transformers`.

---

## Model routing (cheapest model that does the job well)

| Job | Model | Why |
|---|---|---|
| Triage / labeling / action extraction | **Haiku 4.5** | high volume, classification-shaped |
| Voice drafts / briefing prose / meeting prep / voice learning | **Sonnet 4.6** | writing + synthesis quality |
| Deal / IC memos, high-stakes drafts | **Opus 4.8** | deepest reasoning, risk framing |

Set in each agent's `model:` frontmatter and per-phase in the workflows. The session
default (`settings.example.json`) is Sonnet.

---

## Setup

1. **Install the Google MCP server** (open-source, covers Gmail/Calendar/Tasks/Drive/Docs):
   ```bash
   pipx install uv        # or have uvx available
   # create a Google Cloud OAuth client (Desktop), then export:
   export GOOGLE_OAUTH_CLIENT_ID=...   GOOGLE_OAUTH_CLIENT_SECRET=...   USER_GOOGLE_EMAIL=you@domain
   ```
   *(Zero-setup alternative: the claude.ai-hosted Gmail/Calendar/Drive connectors work
   without an OAuth app but lack Google Tasks — RAHU then falls back to a Doc checklist.)*

2. **Activate config:** review `.claude/settings.example.json`, then
   `cp .claude/settings.example.json .claude/settings.json`.
   (Shipped as `.example` so no permissions/hooks activate without your explicit OK.)

3. **Teach it your voice:** run `/learn` once. Re-run monthly to stay current.

4. **Use it:** `/briefing` each morning · `/catchup` anytime · `/prep` before meetings ·
   `/loop --interval 15m /autopilot 20m` for always-on · `/memo <company>` for deals.

---

## Safety posture

RAHU **drafts, labels, and prepares — it never sends mail or creates calendar invites
without you**. `gmail_send_message` and `calendar_create_event` sit in `permissions.ask`,
and `pre-send-guard.sh` hard-denies sends unless you create `.claude/memory/AUTOSEND_ENABLED`.
Memory stores distilled *patterns*, never raw bodies, secrets, or OTPs, and is gitignored.
This mirrors Dimension's review-and-send default.
