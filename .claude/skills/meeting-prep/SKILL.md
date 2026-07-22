---
name: meeting-prep
description: Walk into every meeting prepared — Dimension's automatic meeting prep. For each upcoming calendar event, assemble who's attending and what they care about, recent threads with them, open follow-ups from prior calls, and relevant deal context. Output goes into the Calendar event description and/or a Google Doc.
---

# meeting-prep

For each upcoming meeting, produce a tight prep brief and attach it where the user
already looks: the **Calendar event** (update its description) and/or a linked
**Google Doc**. No new app.

## Procedure (per event from `list_calendars`/`get_events`; hosted: `list_events`/`search_events`)
1. Identify attendees from the event; for each, `recall --kind contact --query "<email>"`.
2. Pull recent threads with those people: `search_gmail_messages` (hosted: `search_threads`)
   `from:/to:<attendee>` newer_than:30d — but prefer the stored `thread` summaries over
   re-reading.
3. `recall --kind deal --query "<company>"` for status/last-conversation if relevant.
4. Find open follow-ups: action-items / Tasks tagged to these people or this company.
5. Compose the brief:
   - **Who & what they care about** (1 line each attendee).
   - **Where we left it** (last conversation + any commitment made).
   - **Open follow-ups** (what you owe them / they owe you).
   - **Goal for this meeting** + 2–3 talking points.
   - **Risks / sensitivities** (from prefs/contact notes).
6. Write it into the event description (`manage_event`; hosted: `update_event`), or a
   Doc linked from the briefing's day-map.

## Recap variant (after the meeting / evening briefing)
Summarize decisions + new action items → create Google Tasks, and persist
`add --kind thread` / `add --kind deal` so the next prep is one recall away.

## Model routing
- Routine internal meetings: **Sonnet**.
- High-stakes external (investor, customer exec, board): **Opus** for sharper
  framing of risks and talking points.

## Guardrails
- Read-only on calendar by default (describe, don't reschedule). Creating/moving
  events sits in `permissions.ask`.
- Don't surface another attendee's private context the user shouldn't have.
