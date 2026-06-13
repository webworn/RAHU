---
description: Draft an IC / deal memo (or pre-call deal brief) into a Google Doc from emails, deck, and notes.
argument-hint: "<company> [memo|brief]"
---

Use the **deal-analyst** agent (Opus) for deal intelligence.

Parse `$ARGUMENTS`: company name + optional mode (`memo` default, or `brief`).

```
Agent({ subagent_type: "deal-analyst",
        prompt: "<mode> for <company>. Recall stored deal+contact context, gather recent threads (Gmail) and the deck/notes (Drive), and write a structured Google Doc following the deal-context skill. Every metric must trace to a source; mark unverified figures [[confirm]]. Return the Doc URL." })
```

Present the Doc URL and list any `[[confirm]]` items the user must verify before
sharing. Never fabricate numbers.
