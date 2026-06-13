---
name: action-items
description: Extract action items from email, meetings, and threads, and turn them into real Google Tasks — Dimension's "action items, all in one place." Deduplicate against existing tasks, set due dates from context, and link back to the source message. Falls back to a Google Doc checklist if Tasks is unavailable.
---

# action-items

Turn scattered asks into one tracked queue of **Google Tasks**.

## Procedure
1. Recall existing context cheaply; list current tasks `tasks_list` to dedupe.
2. From the source (a triaged message, a meeting recap, a thread summary), extract
   only genuine commitments/asks — imperative, has an owner-is-the-user, actionable.
   Skip FYIs and things already done.
3. For each item, build a Task:
   - **title**: short verb-first ("Reply to Anand re: API pricing").
   - **due**: infer from context ("by Friday", "EOD") → concrete date; else leave unset.
   - **notes**: 1-line context + the Gmail/Doc link to the source.
4. Dedupe: if a near-identical open task exists, update it instead of adding.
5. Insert via `tasks_insert`. Report the list back to the briefing.

## Fallback (hosted-connector-only setups without Tasks)
Create/append a Google Doc "RAHU Action Items — <date>" with `[ ]` checkboxes and
the same fields. The briefing links to it.

## Model routing
- **Haiku** — extraction is classification-shaped and high volume.

## Guardrails
- Don't invent deadlines; only set `due` when the source states/implies one.
- One task per real commitment — no duplicates, no vague "follow up" with no object.
