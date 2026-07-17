# RAHU — your AI coworker, inside Gmail

RAHU turns Claude Code into an AI coworker that lives entirely in your Google apps.
It auto-sorts your inbox with **your own labels**, drafts replies in **your own voice**,
and writes your morning briefing — all landing as Gmail labels/drafts, Calendar notes,
Google Tasks, and Docs. No new app, no dashboard. It's a Google-native take on
[Dimension.dev](https://dimension.dev).

---

## Quickstart (3 steps)

You only need **Claude Code already installed**. That's it.

### 1. Drop this repo into a folder and open Claude Code there
```bash
git clone https://github.com/webworn/RAHU.git
cd RAHU
claude
```

### 2. Connect Google
This repo ships a `.mcp.json`, so **Claude Code auto-detects the Google server the moment
you open the folder** and asks you to approve it — just say yes. On first use your
**browser opens** for a normal Google sign-in, then RAHU can read labels, draft, and
write to Calendar / Tasks / Docs.

**One-time prerequisites (≈5 min).** The repo ships the *recipe*, not the server — an MCP
server is a program that runs on your machine, so two things must exist first:

```bash
# 1. uv — provides `uvx`, which fetches & runs the Google server. Without it,
#    the server fails to start with "command not found".
curl -LsSf https://astral.sh/uv/install.sh | sh     # Windows: irm https://astral.sh/uv/install.ps1 | iex

# 2. Your own Google OAuth *desktop* client — a self-hosted server has to act as
#    you, and there's no way around supplying your own credential.
export GOOGLE_OAUTH_CLIENT_ID=...       # Google Cloud Console → APIs & Services → Credentials
export GOOGLE_OAUTH_CLIENT_SECRET=...
export USER_GOOGLE_EMAIL=you@your-domain.com
export WORKSPACE_MCP_DEFAULT_TIMEZONE=Asia/Kolkata   # optional, defaults to UTC
```

**Check it before you hit a confusing failure:**
```bash
python3 .claude/memory/store.py doctor    # or just run /doctor inside Claude Code
```
It tells you exactly what's missing and how to fix it.
> **Just want a quick taste?** Run `/mcp` and pick the hosted **Gmail** connector instead —
> zero setup, but it covers labeling + drafting only (no Tasks/Docs, so `/briefing` and
> `/memo` are unavailable). The full experience uses the `.mcp.json` server above.

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
| `/doctor` | Preflight — checks `uvx`, OAuth vars, python3, and your memory store, and says exactly what's missing |
| `/learn` | Learns your labels, tagging rules, and writing voice from your own Gmail (run once, refresh monthly) |
| `/label` | Auto-applies **your** labels to new mail, silently. `/label dry-run` previews without changing anything |
| `/catchup` | Summarizes every new email and leaves a ready-to-send **draft** for each |
| `/briefing` | Writes today's briefing (overnight mail + meetings + tasks) as a **Google Doc** |
| `/prep` | Preps your upcoming meetings into the **Calendar** event |
| `/memo <company>` | Drafts a deal / IC memo into a **Google Doc** |

Want it always-on? Keep a session open and run:
```
/loop --interval 10m /label 15m
```
It re-labels new mail every 10 minutes.

---

## How it works (the short version)

- **Dynamic, per-user — nothing is hardcoded.** RAHU reads *your* live Gmail labels and
  learns *your* sorting rules from *your* history. A different person gets a different
  scheme with zero code changes.
- **Local memory.** What it learns (your labels, tagging rules, writing voice, contacts)
  is stored in a small local file (`.claude/memory/`), never uploaded. It recalls only the
  few facts it needs each time, so it stays fast and cheap.
- **Right model for the job.** Cheap **Haiku** for high-volume triage, **Sonnet** for
  writing, **Opus** for deal memos.
- **Safe by default.** RAHU **drafts and labels — it never sends email or moves your
  calendar without you.** Learned data and any auto-send switch are git-ignored.

---

## What's inside `.claude/`

```
commands/    what you type   (/learn /label /catchup /briefing /prep /memo /autopilot)
agents/      the specialists (inbox-triage, voice-drafter, briefing-writer, … model-routed)
skills/      the "how" for each capability
workflows/   multi-step orchestration (briefing, catch-up, autopilot, learn)
hooks/       optional automation + a send-safety guard
memory/      store.py — your local, private learning store
```

---

## Optional: permissions, hooks & always-on

The Google server itself is already wired via `.mcp.json` (step 2). To also **pre-approve
the safe tool calls** (so RAHU stops asking on every label/draft), **inject your memory
digest at session start**, and turn on the **send-safety latch**, review and copy the
example settings:
```bash
cp .claude/settings.example.json .claude/settings.json   # read it first
```
It's shipped as `.example` on purpose — nothing grants permissions or registers hooks
until you opt in. Once copied, keep it always-on with `/loop --interval 10m /label 15m`.
The underlying server is the open-source
[`workspace-mcp`](https://github.com/taylorwilsdon/google_workspace_mcp).

---

## Privacy

RAHU runs on your machine through your own Claude Code. It stores distilled *patterns*
(e.g. "mail from vendor X → label Purchase"), never raw email bodies, passwords, or
one-time codes.

**Your profile is yours, and it never ships.** Nothing learned is in this repo — a fresh
clone contains the engine, not the knowledge, which is why *you* run `/learn` once (your
labels aren't anyone else's). It lives outside the clone at **`~/.rahu/memory.db`**, so
re-cloning, moving the folder, or `git clean -xdf` can't wipe it. Point it elsewhere — or
share one profile across several clones — with `RAHU_MEMORY_DB=/path/to/memory.db`.
