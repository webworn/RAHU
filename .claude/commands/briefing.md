---
description: Generate today's RAHU morning (or evening) briefing as a Google Doc — triage, drafts, tasks, meeting prep, all in one.
argument-hint: "[morning|evening] [window e.g. 1d]"
---

Run the RAHU briefing workflow.

Parse `$ARGUMENTS`: first token is mode (`morning` default, or `evening`), second is
the lookback window (default `1d`).

Invoke:

```
Workflow({ name: "rahu-morning-briefing", args: { mode: "<mode>", window: "<window>" } })
```

When it returns, give the user the Google Doc URL, the counts (triaged / drafted /
tasks), and explicitly list any drafts flagged for human review under "Needs you".
Do not send anything — drafts wait in Gmail for review.
