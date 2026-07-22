# RAHU — your AI coworker, inside Gmail

RAHU turns Claude Code into an AI coworker that lives entirely in your Google apps.
It auto-sorts your inbox with **your own labels**, drafts replies in **your own voice**,
and writes your morning briefing — all landing as Gmail labels/drafts, Calendar notes,
Google Tasks, and Docs. No new app, no dashboard. It's a Google-native take on
[Dimension.dev](https://dimension.dev).

---

## Quickstart

### 1. Drop this repo into a folder and open Claude Code there
```bash
git clone https://github.com/webworn/RAHU.git
cd RAHU
claude
```

### 2. Connect Google — pick one of two paths

**Path A — hosted connectors (zero setup, recommended to start).**
Run `/mcp` and authenticate the claude.ai **Gmail**, **Google Calendar**, and
**Google Drive** connectors (a normal browser sign-in each; no OAuth app, no installs).
This covers labeling, voice drafts, the briefing Doc, and meeting prep.
Not on this path: Google Tasks (action items fall back to a checklist in the briefing
Doc or a draft), updating a Doc in place (create-only), and sending mail — the hosted
Gmail connector literally has no send tool, so it is draft-only by construction.

**Path B — self-hosted `workspace-mcp` (the full experience).**
The repo ships `.mcp.json` (version-pinned server); Claude Code auto-detects it and asks
you to approve. Two one-time prerequisites, ≈5 min:

```bash
# 1. uv — provides `uvx`, which fetches & runs the pinned Google server.
curl -LsSf https://astral.sh/uv/install.sh | sh     # Windows: irm https://astral.sh/uv/install.ps1 | iex

# 2. Your own Google OAuth *desktop* client — a self-hosted server acts as you.
export GOOGLE_OAUTH_CLIENT_ID=...       # Google Cloud Console → APIs & Services → Credentials
export GOOGLE_OAUTH_CLIENT_SECRET=...
export USER_GOOGLE_EMAIL=you@your-domain.com
export WORKSPACE_MCP_DEFAULT_TIMEZONE=Asia/Kolkata   # optional, defaults to UTC
```

This adds real Google Tasks, in-place Doc updates, and (always ask-gated) send.
Every agent is wired for **both** families — see `TOOLNAMES.md`, the verified source of
truth for every Google tool name RAHU uses.

**Check your setup any time:**
```bash
python3 .claude/memory/store.py doctor    # or just run /doctor inside Claude Code
```
It tells you exactly what's missing and how to fix it. `/learn` runs it automatically.

### 3. Teach it your inbox, then use it
```
/learn      ← reads your existing labels + how you already sort mail, and learns your scheme
/label      ← auto-labels new mail using what it learned (try "/label dry-run" first to preview)
```

That's the whole setup. Everything below is optional.

---

## What you can say

| Type this | What happens |
|---|---|
| `/doctor` | Preflight — checks `uvx`, OAuth vars, python3, settings, and your memory store |
| `/learn` | Learns your labels, tagging rules, and writing voice from your own Gmail (run once, refresh monthly) |
| `/label` | Auto-applies **your** labels to new mail, silently. `/label dry-run` previews without changing anything |
| `/catchup` | Summarizes every new email and leaves a ready-to-send **draft** for each |
| `/briefing` | Writes today's briefing (overnight mail + meetings + tasks) as a **Google Doc** |
| `/prep` | Preps your upcoming meetings into the **Calendar** event |
| `/memo <company>` | Drafts a deal / IC memo into a **Google Doc** |
| `/autopilot` | One full pass: triage + draft + tasks for everything new |
| `/recalibrate` | Learns from your corrections — where you overrode a label, the rule gets refined |
| `/stats` | 7-day readout from the local audit trail: what RAHU labeled, top labels, memory totals |

Want it always-on? Keep a session open and run:
```
/loop --interval 10m /label 15m
```
It re-labels new mail every 10 minutes — and thanks to a cursor pushed into the Gmail
query itself, each pass reads only genuinely-new mail instead of re-fetching the window.

---

## How it works (the short version)

- **Dynamic, per-user — nothing is hardcoded.** RAHU reads *your* live Gmail labels and
  learns *your* sorting rules from *your* history. A different person gets a different
  scheme with zero code changes.
- **It keeps learning.** Every applied label is recorded in a local audit trail; run
  `/recalibrate` and your manual corrections become refined rules instead of being
  forgotten.
- **Local memory.** What it learns lives in a small local SQLite file at
  `~/.rahu/memory.db` — never uploaded, and it survives re-clones. It recalls only the
  few facts it needs each time, so it stays fast and cheap.
- **Right model for the job.** Cheap **Haiku** for high-volume triage, **Sonnet** for
  writing, **Opus** for deal memos and high-stakes recipients (flagged drafts get an
  automatic Opus re-draft pass in the briefing).
- **Drafts, doesn't send.** On the hosted path sending is impossible (no send tool
  exists). On the self-hosted path two things stand in the way: Claude Code asks before
  any send, and RAHU's send-latch hard-denies one. **The latch only runs once you copy
  `settings.json` (below)** — run `/doctor` to see which you have.

---

## What's inside `.claude/`

```
commands/    what you type   (/learn /label /catchup /briefing /prep /memo /autopilot /recalibrate /stats /doctor)
agents/      the specialists (inbox-triage, voice-drafter, briefing-writer, … model-routed, dual-connector)
skills/      the "how" for each capability
workflows/   multi-step orchestration (briefing, catch-up, autopilot, learn, recalibrate)
hooks/       session memory digest + the send-safety guard
memory/      store.py — your local, private learning store
```
Plus `TOOLNAMES.md` (the verified tool-name table — never guess a name) and
`tests/mock-workflow-harness.mjs` (dry-runs any workflow with scripted fake agents).

---

## Recommended: turn on the send-latch, permissions & hooks

The send-safety latch, the permission allowlist (so RAHU stops asking on every
label/draft), and the session-start memory digest all live in the example settings:
```bash
cp .claude/settings.example.json .claude/settings.json   # read it first
```
It ships as `.example` on purpose: nothing grants permissions or registers hooks until
you opt in. The cost is that a fresh clone has no send-latch and prompts on every tool
call — `/label` warns you about this, and `/doctor` reports it.
The underlying self-hosted server is the open-source
[`workspace-mcp`](https://github.com/taylorwilsdon/google_workspace_mcp), version-pinned
in `.mcp.json`.

---

## Privacy

RAHU runs on your machine through your own Claude Code. It stores distilled *patterns*
(e.g. "mail from vendor X → label Purchase") and a distilled audit trail
(label applied + sender domain) — never raw email bodies, passwords, or one-time codes.

**Your profile is yours, and it never ships.** Nothing learned is in this repo — a fresh
clone contains the engine, not the knowledge, which is why *you* run `/learn` once (your
labels aren't anyone else's). It lives outside the clone at **`~/.rahu/memory.db`**, so
re-cloning, moving the folder, or `git clean -xdf` can't wipe it. Point it elsewhere — or
share one profile across several clones — with `RAHU_MEMORY_DB=/path/to/memory.db`.
