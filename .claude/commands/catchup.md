---
description: Catch Up — summarize every new email and leave a ready-to-send Gmail draft for each.
argument-hint: "[window e.g. 1d]"
---

Run the Catch-Up workflow over new mail.

Use `$ARGUMENTS` as the window (default `1d`). Invoke:

```
Workflow({ name: "rahu-catchup", args: { window: "$ARGUMENTS" } })
```

Present the result as a scannable list: for each message — sender · subject ·
1-line summary · the draft gist (already saved in Gmail). End with how many drafts
are waiting for the user to review and send. Never auto-send.
