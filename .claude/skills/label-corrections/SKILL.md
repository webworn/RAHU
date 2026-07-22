---
name: label-corrections
description: Detect where the user overrode a label RAHU applied and turn that into a refined tagging rule — the correction loop that makes /label get more accurate over time instead of staying frozen at whatever /learn first inferred.
---

# label-corrections

`/learn` infers tagging rules once; `/label` applies them forever after. If the user
keeps quietly fixing RAHU's guesses, RAHU never finds out. This skill defines what
counts as a real correction and how to turn it into a better rule — nothing here talks
to Gmail beyond reading; all writes go to local memory.

## What counts as a correction (and what doesn't)

Compare the label RAHU **applied** to a message against the labels on it **now**.

- **Correction (act on it):** the label RAHU applied is gone, and/or a different label
  from the same group (typically the learned pick-one group) is there instead. That is
  the user saying "you got the status/category wrong."
- **Not a correction (ignore it):** the user added an *extra*, orthogonal label on top
  of the one RAHU applied (e.g. a personal/star-style label from a different group).
  RAHU's original label is still present — nothing was overridden, the user just
  layered on more information. Also ignore messages RAHU never touched (no processed
  marker / no audit record) and messages where current labels exactly match what was
  applied.

When in doubt — sparse evidence, ambiguous which group the swap belongs to, or the
applied label can't be determined with any confidence — skip the message rather than
writing a speculative rule. A missed correction is cheap; a wrong rule compounds every
future run.

## Sourcing the "before" state

Prefer a stored `audit` fact (one per applied label change, keyed by message id) if
present — it's the ground truth for what RAHU actually applied. If no audit trail
exists for a message, fall back to whatever context is available on the RAHU processed
marker/thread to infer what was applied, and treat that inference as lower-confidence:
skip it rather than guess if it's not clear.

## Writing the correcting fact

Refine the *rule*, don't log the *incident*. The store already has a `tagging` fact for
the label RAHU wrongly applied (and/or one for the label the user moved it to) — upsert
onto that same key so the correction sharpens the existing rule instead of piling up
one-off notes:

```bash
python3 .claude/memory/store.py add --kind tagging --key "<label-key>" \
  --text "<refined rule>; note: user moved <sender/subject pattern> mail from <old label> to <new label>"
```

Good refined rule: a pattern generalized from the correction (sender domain, keyword,
automated-sender signature) plus which label it should now map to. Bad: "message 18f2a
was wrong" — that's a fact about one email, not a rule that helps the next one.

**Never invent a label.** Only reference labels that are already in the learned
`labelmap` / the live label list. If a correction implies a label that doesn't exist,
skip it and let `/learn` re-derive structure instead of guessing at a new one.

## Guardrails

- Read-only against Gmail. This loop never modifies a message, label, or draft — it
  only fetches current label state and writes to `.claude/memory/store.py`.
- Never store raw email bodies or full subject lines verbatim beyond a short pattern —
  store the *pattern*, the way `tagging` facts already do.
- Operate silently: no notifications, no drafts, no side effects the user has to review
  beyond the summary `/recalibrate` prints.
- Idempotent by design: re-running over the same window just re-upserts the same keys,
  it doesn't duplicate facts or re-litigate corrections already folded into the rule.
