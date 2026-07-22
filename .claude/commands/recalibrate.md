---
description: Compare RAHU's applied labels against the user's later corrections and refine the learned tagging rules. Closes the loop that /learn + /label leave open.
argument-hint: "[window e.g. 7d]"
---

Run the correction loop: find where the user overrode a label RAHU applied, and refine
the learned rule so the same mistake stops recurring.

Preflight: confirm the user has been learned —
`python3 .claude/memory/store.py recall --kind labelmap --k 1`.
If empty, tell them to run `/learn` first and stop.

Scope from `$ARGUMENTS` (default `7d`). Invoke:

```
Workflow({ name: "rahu-recalibrate", args: { window: "$ARGUMENTS" } })
```

Report how many messages were sampled, how many genuine corrections were found, and
which tagging rules were refined (key + new rule text). If there were zero corrections,
say so plainly — that means RAHU's current rules are holding. This never touches Gmail;
it only reads mail and updates local memory, so it's safe to run anytime, including
inside `/loop`.
