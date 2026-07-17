#!/usr/bin/env bash
# PreToolUse hook on any Gmail SEND tool — the autopilot safety latch.
#
# RAHU drafts by default. An actual SEND is only allowed if the user has explicitly
# opted in by creating .claude/memory/AUTOSEND_ENABLED. Otherwise we DENY and tell the
# agent to leave a draft instead. This keeps "never auto-send" true even if someone
# widens permissions by mistake.
#
# FAIL-CLOSED BY DESIGN: this script must ALWAYS print a decision. It deliberately uses
# only bash builtins — no python3, no jq. It previously shelled out to python3 under
# `set -e`, so on a machine without python3 it exited non-zero printing NOTHING, and the
# send fell through to normal permissioning. A safety latch that needs an interpreter to
# say "no" is not a safety latch. Do not reintroduce that dependency.
set -uo pipefail   # NOTE: no `-e` — a non-zero builtin must never abort before we print.

cd "$(dirname "$0")/.." || true   # -> .claude/

emit() {  # $1 = permissionDecision, $2 = reason
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"%s","permissionDecisionReason":"%s"}}\n' "$1" "$2"
}

if [ -f "memory/AUTOSEND_ENABLED" ]; then
  emit "ask" "Auto-send is opted in (AUTOSEND_ENABLED present) — still confirming each send."
else
  emit "deny" "RAHU safety latch: sending is disabled. Save a Gmail draft for review instead. To enable auto-send, create .claude/memory/AUTOSEND_ENABLED."
fi
exit 0
