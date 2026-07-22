---
description: Auto-apply YOUR Gmail labels (learned from your own history) to new mail, silently. Dynamic per user. Wrap with /loop for always-on.
argument-hint: "[window e.g. 1d | dry-run]"
---

Run dynamic inbox labeling. Nothing about the taxonomy is hardcoded — it uses your
live Gmail labels + the conventions learned into local memory by `/learn`.

Preflight: confirm the user has been learned —
`python3 .claude/memory/store.py recall --kind labelmap --k 1`.
If empty, tell them to run `/learn` first and stop.

Also check `test -f .claude/settings.json`. If missing, warn the user that
silent labeling is impossible without it — every label call will prompt —
and point them to `cp .claude/settings.example.json .claude/settings.json`.
Warn and continue; do not stop.

Scope from `$ARGUMENTS` (default `1d`). If it contains `dry-run`, classify and REPORT
proposed labels per email but DO NOT modify anything — let the user verify first.

Spawn the triage agent:

```
Agent({ subagent_type: "inbox-triage",
        prompt: "Label new Gmail (newer_than:<window>) dynamically per the email-triage skill: fetch the live label list, load the learned labelmap/tagging/pref from memory, apply matching deterministic rules, then judge the rest. Apply the learned pick-one group exactly once (removing any prior label from it) + the learned multi-select categories. Honor learned prefs (retired labels, silent apply). Mark processed. Apply silently. Return a one-line-per-email summary." })
```

Present the per-email summary for spot-checking. Always-on: `/loop --interval 10m /label 15m`.
After live runs, the agent persists new rules it learned, so accuracy improves over time.
