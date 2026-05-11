---
title: MCP server
description: AnySpace exposes a local HTTP MCP server so external editors (Cursor, Claude Code, Claude Desktop, Codex, Windsurf) can read and write your tasks, notes, team messages, and terminal context.
section: integrations
order: 10
updated: 2026-05-11
---

AnySpace ships a Model Context Protocol (MCP) server on `127.0.0.1` that any MCP-aware client can talk to. With it, your other editor can:

- List and create kanban tasks
- Save, search, and link project knowledge notes (`.anyspace/knowledge/`)
- Read team `MESSAGES.md` and ping `@operator`
- Read what's currently on a terminal pane's screen
- Drive the live preview pane (open, screenshot, click, fill, navigate)

No cloud, no account. The server only binds to loopback; the bearer token is the entire security surface.

## What's exposed

23 tools across five surfaces:

| Surface | Tools |
|---|---|
| **Preview** | `preview_open`, `preview_screenshot`, `preview_click`, `preview_fill`, `preview_navigate`, `preview_detect`, `list_panes` |
| **Knowledge** | `save_note`, `get_note`, `list_notes`, `search_notes`, `find_backlinks`, `link_notes` |
| **Kanban** | `list_kanban_tasks`, `create_kanban_task`, `update_kanban_task`, `move_kanban_task` |
| **Teams + messages** | `list_teams`, `read_team_messages`, `send_team_message` |
| **Terminal** | `read_pane_output`, `team_broadcast`, `team_send_to_pane` |

Tool descriptions are loaded by your MCP client when it connects — call `tools/list` to see the full schemas.

## Install

Settings → **Code Agent API** has copy-paste install strings for both flows.

### From a Code-Agent terminal pane (recommended)

If you're running an AI CLI inside an AnySpace Code-Agent terminal pane, the env already contains `$ANYSPACE_API_URL`, `$ANYSPACE_API_TOKEN`, `$ANYSPACE_PANE_ID`, `$ANYSPACE_TAB_ID`. Use those literally:

```bash
claude mcp add --transport http anyspace "${ANYSPACE_API_URL}/mcp" \
  --header "Authorization: Bearer ${ANYSPACE_API_TOKEN}" \
  --header "X-Pane-Id: ${ANYSPACE_PANE_ID}" \
  --header "X-Tab-Id: ${ANYSPACE_TAB_ID}"
```

Claude Code (and other clients that honor env interpolation) re-resolves `${VAR}` on each startup, so every `claude` instance inherits its own pane and tab id.

### From an external editor (Cursor, Claude Desktop, Codex, Windsurf)

Copy the resolved URL and token from Settings → **Code Agent API → External clients**:

```bash
claude mcp add --transport http anyspace "http://127.0.0.1:PORT/mcp" \
  --header "Authorization: Bearer <token>"
```

For clients that prefer JSON (Claude Desktop, Cursor's `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "anyspace": {
      "transport": "http",
      "url": "http://127.0.0.1:PORT/mcp",
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

The port changes on every AnySpace restart. The token persists across restarts unless you rotate it from Settings.

## Pane / tab context

Tools fall into two camps:

- **Pane-anchored tools** — `preview_*`, `read_pane_output`, anything that drives a specific terminal — use `X-Pane-Id` / `X-Tab-Id` headers to know *which* pane the caller is in. When the headers are missing, the bridge falls back to the active tab and the first matching pane it finds.
- **Workspace-scoped tools** — `list_kanban_tasks`, `list_notes`, `list_teams`, `read_team_messages` — don't need pane context. They operate on the AnySpace workspace as a whole. If they need a `projectPath` and you don't pass one, they resolve it from the caller's tab → active tab → first tab with a project.

In practice: a `claude` running in an AnySpace terminal pane has the right pane id automatically. Cursor on your laptop won't send headers, and the tools will quietly act on whichever tab is active in AnySpace at call time.

## Safety / write semantics

A few tools write into live terminals. They share AnySpace's "never auto-execute" invariant:

- `team_broadcast(teamId, text, withNewline?)` writes `text` into every terminal pane of a team. By default `withNewline=false` — the bytes sit at each prompt waiting for the operator to press Enter. Set `withNewline=true` to execute immediately in every pane.
- `team_send_to_pane(teamId, text, paneId? | label?, withNewline?)` does the same for one specific pane. Resolve by `paneId` or by team-agent `label` (e.g. `"Coordinator 1"`).
- `send_team_message(teamId, to, body, type?, from?)` appends a message to MESSAGES.md. The team's operator-inbox watchers see it and pings show up in the status bar.

`read_pane_output` is read-only — it returns the live xterm screen plus the most recent finished OSC 133 block. Safe to call freely.

The whole server is loopback-only and the bearer token is the only gate. If your token leaks, anyone with localhost access (a local process, an SSH tunnel) can call every tool, including the terminal-write ones. Rotate the token from Settings → **Code Agent API → Rotate token** if that ever happens.

## Project knowledge notes

The six note tools operate on `<projectPath>/.anyspace/knowledge/`. If your tab has a `projectPath` set, you don't need to pass one explicitly. If you're calling from an external editor with no pane context, either pass `projectPath` or open a workspace tab in AnySpace first.

If you save a note from outside while AnySpace's Knowledge view is open for that project, the file watcher (150 ms debounce) refreshes the list automatically. If you save a note for a project the Knowledge view has never been opened for, the new note shows up the next time you open the view.

## Troubleshooting

### "Connection refused" / wrong port after restart

The port changes on every restart. If your client persists the URL literally (`http://127.0.0.1:54321/mcp`), re-run the install command after each AnySpace restart. The terminal-pane install string uses `${ANYSPACE_API_URL}` env interpolation, which re-resolves on each `claude` startup automatically.

### 401 Unauthorized

The bearer token in your install string doesn't match the current one. Either:
- Copy a fresh token from Settings → **Code Agent API → Bearer token** and re-run the install command, or
- If you just rotated the token, restart AnySpace (the in-memory server keeps the old token until restart).

### "no project context — pass projectPath or open a workspace tab"

A note tool was called and couldn't resolve a project. Either pass an explicit `projectPath` arg, or open an AnySpace tab with a project folder selected.

### Tool list looks short / tools missing

`tools/list` honors the server-side `tool_router`, not your client's local cache. Restart your client. If a specific tool still doesn't appear, the bearer token is probably wrong and the server is rejecting before listing.

### `team_broadcast` doesn't write into panes

Check that the team's `tabId` is live (`list_teams` shows `tabId: null` if the workspace tab is closed). Archived teams or teams whose tab was closed can't broadcast — re-launch the team from the Teams view first.

## Related

- [Team mode](/docs/team/team-mode) — how teams, BOARD.md, and MESSAGES.md fit together
- [Knowledge](/docs/day-to-day/knowledge) — note layout, wikilinks, graph view
- [Code Agent API settings](/docs/reference/settings-data) — what's persisted and where
