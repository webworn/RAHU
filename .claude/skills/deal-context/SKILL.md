---
name: deal-context
description: Lightweight CRM and deal intelligence — Dimension's VC/founder features. Maintain per-deal context from email + meetings, prepare pre-call deal briefs, and draft an IC (investment committee) / deal memo by pulling from emails, decks (Drive), meeting notes, and stored context. Output is a Google Doc.
---

# deal-context

A file-backed CRM that lives in the memory store + Google Drive — no separate CRM app.

## Maintain deal state
After relevant emails/meetings, persist:
```bash
python3 .claude/memory/store.py add --kind deal --key "acme" \
  --text "Acme Series A. Stage: diligence. Last: sent term sheet 06-10. Owner: Suman. Next: legal review. Risk: competing offer."
python3 .claude/memory/store.py add --kind contact --key "anand@acme.com" \
  --text "Anand — CEO Acme. Champion. Prefers data over narrative."
```
Recall before any call/memo: `recall --kind deal --query "<company>"`.

## Pre-call deal brief
Same shape as meeting-prep but deal-first: stage, last conversation, what changed
since, open asks, the one decision this call should reach. Goes into the Calendar
event or the briefing.

## IC / deal memo (the Dimension "IC memo" feature)
1. Gather inputs: stored `deal`/`contact`/`thread` facts; recent threads
   (`gmail_list_messages`); the deck and notes from `drive_search` (`docs_create`/Drive).
2. Draft a structured memo Doc: Summary · Team · Market · Product · Traction ·
   Terms · Risks · Recommendation. Cite each claim's source (email/deck/notes).
3. Mark every unverified number as `[[confirm]]` — never fabricate metrics.
4. `docs_create` the memo; link it from the briefing and the deal's contact note.

## Model routing
- **Opus** — deal memos and risk framing are the highest-reasoning task in RAHU.

## Guardrails
- Numbers and claims must trace to a source; unknowns are `[[confirm]]`, not guesses.
- Treat deal data as sensitive: store facts, not raw confidential attachments.
