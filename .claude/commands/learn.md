---
description: Learn / refresh the user's writing voice and Gmail tagging conventions from their email trails into local memory.
---

Refresh the RAHU context profile from the user's own email history.

```
Workflow({ name: "rahu-learn-voice" })
```

When done, summarize what the profile now knows (voice patterns per audience, tagging
rules) and flag anything thin. Remind the user this is local-only (`.claude/memory/`),
stores distilled patterns not raw email, and should be re-run periodically as their
style drifts. This is what makes drafts sound like them and triage tag like them.
