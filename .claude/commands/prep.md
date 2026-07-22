---
description: Prepare briefs for today's (or a named) meeting — context, recent threads, follow-ups — into the Calendar event.
argument-hint: "[today|tomorrow|<meeting title>]"
---

Use the **meeting-prep** agent to prepare upcoming meetings.

Scope from `$ARGUMENTS` (default `today`). Spawn:

```
Agent({ subagent_type: "meeting-prep",
        prompt: "Prepare briefs for <scope> meetings. Write each into its Calendar event description or a linked Google Doc. Recall contact + deal context from memory first. Return one line per meeting with the prep link." })
```

If a meeting is high-stakes (investor / customer exec / board), note it and offer an
Opus re-run for sharper risk framing. Calendar stays read-only — describe, don't move.

If Google tool calls fail, run `python3 .claude/memory/store.py doctor` and relay
its findings instead of retrying blindly.
