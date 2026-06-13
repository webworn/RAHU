#!/usr/bin/env bash
# PreToolUse hook on gmail_send_message — the autopilot safety latch.
# RAHU drafts by default. An actual SEND is only allowed if the user has explicitly
# opted in by creating the file .claude/memory/AUTOSEND_ENABLED. Otherwise we DENY and
# tell the agent to leave a draft instead. This makes "never auto-send" the default
# even if someone widens permissions by mistake.
set -euo pipefail
cd "$(dirname "$0")/.." 2>/dev/null || cd "$(dirname "$0")/.."

if [ -f "memory/AUTOSEND_ENABLED" ]; then
  python3 - <<'PY'
import json
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse",
  "permissionDecision":"ask",
  "permissionDecisionReason":"Auto-send is opted-in (AUTOSEND_ENABLED present) — still confirming each send."}}))
PY
else
  python3 - <<'PY'
import json
print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse",
  "permissionDecision":"deny",
  "permissionDecisionReason":"RAHU safety latch: sending is disabled. Save a Gmail draft for review instead. To enable auto-send, create .claude/memory/AUTOSEND_ENABLED."}}))
PY
fi
