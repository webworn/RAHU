---
description: Preflight check — verifies python3, the memory store, uvx, and the Google OAuth env vars, and tells you exactly what's missing.
---

Run the RAHU preflight and report the result to the user verbatim:

```bash
python3 .claude/memory/store.py doctor
```

Then, in one or two sentences, tell them the single most useful next step:

- **Core ✗** (python3 / store not writable) → that must be fixed first; nothing else works.
- **Workspace path incomplete** (`uvx` missing or OAuth vars unset) → they have a real
  choice, so state both: install `uv` + create a Google OAuth desktop client for the full
  experience (Tasks/Docs, `/briefing`, `/memo`), **or** run `/mcp` and pick the hosted
  Gmail connector for zero setup with labeling + drafting only.
- **Google auth was working and now fails with `invalid_grant`** → their OAuth client is
  almost certainly still in *Testing* status (tokens expire every 7 days). Tell them to
  publish the consent screen to Production (or use the Internal user type on Workspace),
  then re-authenticate once.
- **0 facts learned** → run `/learn` (it builds their profile from their own Gmail).
- **All ✓** → suggest `/label dry-run`.

Do not paper over failures — if the Google server can't start, say so plainly rather than
implying setup is complete.
