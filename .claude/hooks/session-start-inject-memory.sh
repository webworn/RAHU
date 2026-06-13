#!/usr/bin/env bash
# SessionStart hook — inject a COMPACT digest of the RAHU memory profile so agents
# start context-aware for almost no tokens. We inject counts + a few top voice/pref
# facts, NOT the whole store (that would defeat the token-efficiency goal).
set -euo pipefail
cd "$(dirname "$0")/.." 2>/dev/null || cd "$(dirname "$0")/.."

STORE="memory/store.py"
[ -f "$STORE" ] || { echo '{}'; exit 0; }

STATS="$(python3 "$STORE" stats 2>/dev/null || echo '{}')"
# A handful of standing prefs + the headline voice facts — the things every draft needs.
PREFS="$(python3 "$STORE" recall --kind pref  --k 4 --max-chars 500 2>/dev/null || echo '{}')"
VOICE="$(python3 "$STORE" recall --kind voice --query 'default greeting sign-off tone' --k 3 --max-chars 600 2>/dev/null || echo '{}')"

CTX="RAHU memory loaded. ${STATS}
Standing prefs: ${PREFS}
Voice headline: ${VOICE}
(Recall more per task via .claude/memory/store.py — do not dump the whole store.)"

# Emit as additionalContext for the session.
python3 - "$CTX" <<'PY'
import json,sys
print(json.dumps({"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":sys.argv[1]}}))
PY
