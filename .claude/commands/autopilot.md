---
description: Inbox Autopilot — continuously triage new mail and pre-draft replies/tasks. Wrap with /loop for always-on.
argument-hint: "[since e.g. 2h]"
---

Run one Inbox Autopilot pass now:

```
Workflow({ name: "rahu-inbox-autopilot", args: { since: "$ARGUMENTS" } })
```

(Default `since` = `2h` if no argument.)

Report processed / drafted / tasked counts. Drafts sit in Gmail for review — RAHU
does **not** send unless the user has explicitly moved `gmail_send_message` from
`permissions.ask` to `allow`.

## Always-on mode
For continuous operation the user types:

```
/loop --interval 15m /autopilot 20m
```

That re-runs this pass every 15 minutes over the last 20 minutes of mail. When the
session is idle and self-paced, schedule the next pass ~900s out (cache stays warm);
stop the loop when the user says so. Prefer the loop over a tight polling cron so the
human stays in control.
