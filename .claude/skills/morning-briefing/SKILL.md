---
name: morning-briefing
description: Produce Dimension's Morning/Evening Briefing — one screen that summarizes overnight email, surfaces action items, maps the day's meetings, and includes a Catch-Up (a summary + ready draft reply per new message). Output is a Google Doc plus a draft-to-self, so it lives entirely in Google.
---

# morning-briefing

Recreate Dimension's single-screen daily briefing inside Google. No separate UI:
the briefing is a **Google Doc** (created via `docs_create`) and optionally a
**draft email to self** so it shows in the inbox.

## What the briefing contains (in this order)
1. **Today's map** — meetings from `calendar_list_events` (today), with gaps marked
   as deep-work windows. One line each: time · title · who · prep-ready? (link).
2. **Overnight digest** — from email-triage output: counts by priority, the 3–5
   P1 items called out by name, bulk/newsletters collapsed to a number.
3. **Action items** — pulled into one list from: email asks, calendar follow-ups,
   and any connected tools. Each becomes/links a Google Task (action-items skill).
4. **Catch Up** — for every new P1/P2 message: a 1–2 line summary + a ready-to-send
   **Gmail draft** (draft-in-voice). The Doc lists "gist → [draft saved]" so the user
   skims and sends from Gmail.
5. **Needs you** — decisions only the human can make (flagged `[[confirm]]` drafts,
   ambiguous priorities, scheduling conflicts).

## Procedure
1. Recall prefs (`recall --kind pref`) for briefing scope/time/tone.
2. Run email-triage over the overnight window → digest + per-message tags.
3. Run draft-in-voice for each P1/P2 needing reply → Gmail drafts.
4. Run action-items extraction → Google Tasks.
5. Run meeting-prep for today's meetings → prep blurbs (link each in the map).
6. Assemble the Doc with `docs_create`; title `RAHU Briefing — <date>`.
7. Persist durable thread summaries (`add --kind thread`) so tomorrow is cheaper.

## Model routing
- Synthesis of the briefing prose: **Sonnet**.
- The underlying triage/extraction loops: **Haiku** (already done by their skills).
- This skill orchestrates; it should not re-read what sub-skills already summarized.

## Evening variant
Same skill, different framing: what got done, what slipped to tomorrow, unsent
drafts still waiting, and tomorrow's first 3 meetings. Pass `mode=evening`.
