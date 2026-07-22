---
description: Show a 7-day summary of what RAHU has actually done — messages labeled, top labels, memory totals — from the local audit trail. Read-only.
---

Read-only report. Do not label, draft, send, or modify anything — only read the local
memory store.

```bash
python3 .claude/memory/store.py stats
python3 .claude/memory/store.py list --kind audit --limit 500
```

If the `audit` list is empty, tell the user the audit trail starts accruing after the
next `/label` or `/catchup` run, and stop there.

Otherwise, each audit line looks like `[id] audit key +Label; from:sender-domain; ts:epoch`.
From it:
- Keep only lines whose `ts:<epoch>` falls within the last 7 days (now − 7×86400).
- Count how many kept lines there are → messages labeled in the window.
- Tally labels that appear after a leading `+` and report the top few.
- Pull `by_kind` from the `stats` output for overall memory totals (unfiltered by time).

Present a short report, e.g.:

```
Last 7 days: 42 messages labeled
Top labels: Finance/Invoices (14), Newsletters (9), Action-Needed (6)
Memory: 118 facts total (audit: 60, tagging: 22, contact: 18, labelmap: 1, pref: 4, ...)
```

If a label or message looks off, that's a signal for the correction loop — don't fix
it here, just report what's in the trail.
