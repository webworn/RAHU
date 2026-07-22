---
name: email-triage
description: Triage the inbox the way Dimension does — auto-label, prioritize, organize every new message before the user opens it. Fully DYNAMIC: it reads the user's OWN Gmail labels live and applies the labeling conventions LEARNED from that user's history. No taxonomy is hardcoded — it works for any user, learns each user's scheme, and gets smarter over time.
---

# email-triage (dynamic, per-user)

Goal: when the user opens Gmail it is already sorted — using *their* labels and *their*
conventions, learned from *their* mail. Nothing about any one user's taxonomy lives in
code; it is discovered at runtime and stored in the per-user local memory.

## Step 0 — load the user's live scheme (never assume labels)
1. **Fetch the user's live Gmail label list** with your label-listing tool — the only
   source of truth for what labels exist right now — names, nesting (`A/B`), counts.
2. **Recall the learned conventions** from per-user memory:
   ```bash
   python3 .claude/memory/store.py recall --kind labelmap --k 1 --max-chars 800   # structure: which group is pick-one
   python3 .claude/memory/store.py recall --kind tagging  --k 40 --max-chars 1800 # learned sender/keyword -> label rules
   python3 .claude/memory/store.py recall --kind pref     --k 8                    # standing rules (e.g. retired labels, silent apply)
   python3 .claude/memory/store.py recall --kind contact  --query "<sender>" --k 3
   ```
   If memory is empty, the user hasn't been learned yet → tell the caller to run
   `/learn` first (it derives the scheme from their history). Do not invent a taxonomy.

## Step 1 — classify against the LIVE labels
For each new message, choose only from labels that actually exist in the fetched list:
- Apply any **deterministic learned rule** that matches (sender domain, known vendor,
  platform/automated sender, keyword trigger) without spending an LLM decision.
- For the rest, judge using the learned `labelmap` structure:
  - If the user has a **pick-one group** (learned — e.g. a set of mutually-exclusive
    labels, often sharing a marker like a numeric prefix), assign **exactly one** from it.
  - Assign **one or more** labels from the remaining **multi-select** groups.
- Respect learned `pref` rules verbatim (retired labels to never apply, "apply silently",
  forced mappings like "government/defense → highest-priority status", etc.).

## Step 2 — apply
- Use the Gmail modify-labels tool. If a pick-one group exists, **remove any existing
  label from that group first** so only one remains; other labels are additive.
- Idempotency: skip threads already carrying the processed marker; add it after labeling.
- Apply **silently** if the user's prefs say so. Never send notifications about labeling.
- **Audit trail (silent, local bookkeeping — not a Gmail write)**: after each label change
  is applied, record it so `/stats` and the correction loop have something to diff against:
  ```bash
  python3 .claude/memory/store.py add --kind audit --key "<message-id>" --text "<+Label / -Label>; from:<sender-domain>; ts:<epoch>"
  ```
  One fact per message (`add` upserts on key, so re-processing just refreshes it).
  Distilled only — never the subject or body, per this repo's send-guard privacy rule:
  patterns, not content.

## Step 3 — learn (keep it dynamic)
When you resolve an ambiguous case or see a new recurring sender/pattern, persist it so
next time is deterministic and cheaper:
```bash
python3 .claude/memory/store.py add --kind tagging --key "<rule-name>" --text "<pattern> -> <label> (+status?)"
python3 .claude/memory/store.py add --kind contact --key "<email>"     --text "<who> -> usually <labels>"
```
If you notice the label *structure* changed (user added/renamed labels, a new pick-one
group), refresh it: `add --kind labelmap ...` — or just suggest the user re-run `/learn`.

## Output
A compact one-line-per-message digest (chosen-status | categories | sender | subject)
for the caller to spot-check. Label only — never send, trash, or archive.

## Guardrails
- Zero hardcoded label names. Everything comes from the live list + per-user memory.
- Use **Haiku** for the classification loop; escalate a single genuinely ambiguous
  message to a stronger model only when the pick-one choice is unclear.
- Keep changes reversible — labeling only; the user's own labels are never removed
  except the single prior pick-one label being replaced.
