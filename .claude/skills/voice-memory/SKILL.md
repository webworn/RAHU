---
name: voice-memory
description: Read and write the local supermemory-style store of the user's writing voice, Gmail tagging rules, contacts, and deals. Use this BEFORE drafting, triaging, or briefing so output matches the user — and AFTER, to persist anything newly learned. Keeps token cost low by recalling only the few relevant facts.
---

# voice-memory

The local memory store at `.claude/memory/store.py` is RAHU's long-term context.
It exists so agents act like *this* user without re-reading whole inboxes every run.

## Recall (do this first, cheaply)

Pull only the slice you need, with a hard character cap:

```bash
# voice for a draft
python3 .claude/memory/store.py recall --kind voice  --query "<subject + recipient relationship>" --k 4 --max-chars 900
# tagging rules for triage
python3 .claude/memory/store.py recall --kind tagging --k 30 --max-chars 1500
# what we know about a person
python3 .claude/memory/store.py recall --kind contact --query "<person name or email>" --k 3
# deal context for a meeting
python3 .claude/memory/store.py recall --kind deal    --query "<company>" --k 3
```

`recall` returns compact JSON (`{"facts":[{kind,key,text}], ...}`). Drop those
`text` values into your reasoning — do **not** fetch raw threads when a stored
`thread` summary already answers the question. That is the token-efficiency contract.

## Write (persist what you learned — keeps memory *dynamic*)

Facts are idempotent on `(kind,key)`, so re-writing a key updates it in place:

```bash
python3 .claude/memory/store.py add --kind voice   --key "greeting:investors" --text "Opens investor mail with 'Hi <first>,' — never 'Hey'. No emoji." --source "learned:Sent"
python3 .claude/memory/store.py add --kind tagging  --key "newsletters" --text "Substack/Mailchimp bulk senders -> label Read-Later, skip Inbox, no Task."
python3 .claude/memory/store.py add --kind contact  --key "anand@acme.com" --text "Anand, CTO Acme. Decision-maker. Last topic: API pricing. Prefers terse replies."
python3 .claude/memory/store.py add --kind thread   --key "thread:18f2a..." --text "3-week negotiation w/ Acme on seat count; agreed 50 seats, pending legal."
```

## Kinds (namespaces)

| kind | holds | written by | read by |
|------|-------|-----------|---------|
| `voice`   | greetings, sign-offs, tone per audience, banned phrases | memory-curator | voice-drafter |
| `tagging` | learned Gmail-label rules | memory-curator | inbox-triage |
| `contact` | per-person role/relationship/last-topic | inbox-triage, deal-analyst | all |
| `deal`    | pipeline / deal status / IC inputs | deal-analyst | deal-analyst, meeting-prep |
| `pref`    | standing rules ("never auto-send to LPs") | user via /learn | all |
| `thread`  | durable summary of a long thread (so we never re-read it) | briefing-writer | all |

## Rules

- Recall before you generate; write after you learn. Both are cheap.
- Never store secrets/OTPs/passwords. Store *patterns and facts*, not raw email bodies.
- If `stats` shows `semantic_available:false`, recall still works (keyword fallback).
  Install `sentence-transformers` for semantic recall; nothing else changes.
