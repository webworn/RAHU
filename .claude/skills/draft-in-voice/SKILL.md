---
name: draft-in-voice
description: Write email replies in the user's own tone and style, learned from their Sent mail — then save them as Gmail drafts (never auto-send by default). This is Dimension's "auto drafting / replies in your tone, ready to send." Use whenever a message needs a response.
---

# draft-in-voice

Produce a reply that reads as if the user wrote it, and leave it as a **Gmail draft**
on the thread for one-click review-and-send. (Dimension: "Just review and send.")

## Procedure
1. **Recall voice** for this audience:
   `recall --kind voice --query "<recipient relationship + topic>" --k 4`.
   Also `recall --kind contact --query "<recipient>"` for relationship + last topic,
   and `recall --kind thread --query "<subject>"` to avoid re-reading the whole thread.
2. Read the latest inbound message (and the stored thread summary, not the full chain).
3. Draft the reply, matching the recalled voice:
   - greeting + sign-off pattern for THIS audience (clients vs peers vs investors),
   - sentence length, formality, emoji/exclamation usage, hedging vs directness,
   - any banned phrases / standing prefs (`recall --kind pref`).
4. Keep it to the point the inbound message requires; do not invent commitments,
   dates, numbers, or promises not supported by context — leave a `[[confirm: ...]]`
   placeholder instead.
5. Save with `gmail_create_draft` (in-reply-to the thread). Report the draft back in
   the briefing/catchup with a 1-line gist so the user can scan many at once.

## Voice fidelity
- The voice profile is built by **memory-curator** from Sent mail and refreshed by
  `/learn`. If a needed pattern is missing, draft conservatively and flag it.
- Default model: **Sonnet** (writing quality). Escalate to **Opus** only for
  high-stakes mail (investors, legal, board) where nuance matters — the caller
  decides via the agent it routes to.

## Hard rules
- NEVER call `gmail_send_message` from this skill. Draft only. Sending is a separate,
  human-gated step (it sits in `permissions.ask`).
- No fabricated facts. Unknowns become explicit `[[confirm]]` placeholders.
- After sending patterns emerge, persist refinements: `add --kind voice ...`.
