# Tool Names — Single Source of Truth

RAHU talks to Google Workspace through **two separate connector families** that
expose **different tool names for the same capability**. Early in this repo's
history those names were guessed rather than verified, and every guess that
didn't match reality failed silently (the tool call errored or no-opped, and
nothing downstream noticed). This file exists so that never happens again.

**Rule: never reference a Google tool name that is not listed in the table
below.** If you need a capability this file doesn't cover, re-verify (see
"How to re-verify" at the bottom) and add a row — don't guess.

## How the prefixes work

- **Self-hosted `workspace-mcp` (pinned to `1.22.0` in `.mcp.json`)** — every
  tool is exposed under a single server name, `google-workspace`, so the full
  tool identifier is `mcp__google-workspace__<name>`, e.g.
  `mcp__google-workspace__search_gmail_messages`.
- **claude.ai-hosted connectors** — each Google product is its own MCP
  server, so the full identifier is `mcp__claude_ai_<Server>__<name>`. The
  three servers in use here are exactly:
  - `mcp__claude_ai_Gmail__<name>`
  - `mcp__claude_ai_Google_Calendar__<name>`
  - `mcp__claude_ai_Google_Drive__<name>`

  Note the capitalization and underscores — `Google_Calendar` and
  `Google_Drive` each have one underscore joining the two words; `Gmail` is
  one word.

The two families are **not interchangeable** and do not always have 1:1
capability parity (see Google Tasks and doc-update-in-place below, both of
which only exist on one side).

## Capability table

| Capability | self-hosted `workspace-mcp` 1.22.0 (`mcp__google-workspace__<name>`) | claude.ai-hosted connector (`mcp__claude_ai_<Server>__<name>`) |
|---|---|---|
| Search/list messages | `search_gmail_messages` | Gmail: `search_threads` |
| Get message content | `get_gmail_message_content` (batch: `get_gmail_messages_content_batch`; thread: `get_gmail_thread_content`) | Gmail: `get_message`, `get_thread` |
| List labels | `list_gmail_labels` | Gmail: `list_labels` |
| Apply/remove labels | `modify_gmail_message_labels` | Gmail: `label_message`, `unlabel_message`, `label_thread`, `unlabel_thread` |
| Create/manage a label | `manage_gmail_label` | Gmail: `create_label` |
| Create draft | `draft_gmail_message` | Gmail: `create_draft` |
| List drafts | (none granted; not needed) | Gmail: `list_drafts` |
| SEND mail | `send_gmail_message` (guarded + ask-gated) | — hosted Gmail has NO send tool (drafts only, inherently safe) |
| Calendar read | `list_calendars`, `get_events` | Google_Calendar: `list_calendars`, `list_events`, `search_events`, `get_event` |
| Calendar write | `manage_event` | Google_Calendar: `create_event`, `update_event` (also: `respond_to_event`, `suggest_time`, `delete_event`) |
| Google Tasks | `list_tasks`, `get_task`, `manage_task` | — no hosted Tasks connector exists; fallback = checklist in the briefing Doc or a Gmail draft |
| Doc create | `create_doc` | Google_Drive: `create_file` |
| Doc read | `get_doc_content` | Google_Drive: `read_file_content`, `download_file_content` |
| Doc update in place | `modify_doc_text` | — none on hosted (create-only) |
| Docs/Drive search | `search_docs`, `search_drive_files` | Google_Drive: `search_files` (also: `list_recent_files`, `get_file_metadata`) |

Sources: `workspace-mcp` column source-verified from the pinned `1.22.0`
wheel's `@server.tool` registrations. `hosted` column discovered post-OAuth
on 2026-07-22 by inspecting the live tool list exposed via `/mcp`.

## RETIRED fictional names — never use

These names were invented before either connector family was source-verified
and **do not exist on either side**. If you see one of these in code, a
prompt, or a skill file, it is a bug — replace it with the correct verified
name from the table above.

- `gmail_list_messages`
- `gmail_get_message`
- `gmail_modify_labels`
- `gmail_create_draft`
- `gmail_send_message`
- `calendar_list_events`
- `calendar_get_event`
- `tasks_list`
- `tasks_insert`
- `docs_create`
- `drive_search`

## How to re-verify

**`workspace-mcp` (self-hosted) names:**
1. Download the exact pinned wheel from PyPI (match the version in
   `.mcp.json`, currently `1.22.0`):
   `pip download workspace-mcp==1.22.0 --no-deps -d /tmp/wmcp`
2. Unpack it and grep the source for tool registrations:
   `unzip -o /tmp/wmcp/workspace_mcp-1.22.0-*.whl -d /tmp/wmcp/unpacked`
   `grep -rn "@server.tool\|@mcp.tool" /tmp/wmcp/unpacked`
3. Each decorated function name (or its explicit `name=` argument) is the
   real tool name. Update this file if anything has changed.

**claude.ai-hosted connector names:**
1. Authenticate the connector via `/mcp` in Claude Code (or the Claude.ai
   connector settings) so the OAuth flow completes.
2. Once connected, inspect the exposed tool list for that server (e.g. via
   `/mcp` tool listing, or by calling `ToolSearch`/the tool listing surface
   in your client) — the names shown there are the ground truth.
3. Record the server's exact capitalized name (`Gmail`, `Google_Calendar`,
   `Google_Drive`) and each tool name, and update this file.
