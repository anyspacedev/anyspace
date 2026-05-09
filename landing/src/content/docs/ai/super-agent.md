---
title: Super Agent
description: Multi-turn AI chat with streaming, tool calling, and full read/write access to the workspace.
section: ai
order: 40
updated: 2026-05-09
---

Super Agent is AnySpace's in-app AI chat — a multi-turn conversation that streams responses, calls tools, and can directly manipulate your workspace. It's the surface you use when a task is too big for a one-shot Super Brain prompt.

It's distinct from [Team mode](/docs/team/team-mode), which spawns external CLI agents (Claude Code, Codex, etc.) into terminal panes. Super Agent runs entirely inside AnySpace.

## Two surfaces

Same engine, two ways to access it:

- **Side rail** — a collapsible panel on the right of any workspace tab. Click the AI rail tab on the right edge to expand. Drag the left edge to resize (240–720px).
- **Full page** — pick **Super Agent** from the sidebar. Same conversation, more room.

The collapsed pill on the workspace's right shows whether you have any active session.

## Sessions

Each session is one persistent conversation:

- Sessions are stored in SQLite and survive app restarts.
- Switch sessions from the rail header dropdown.
- Each session can override the system prompt globally configured in Settings.

A new session starts with the system prompt from **Settings → Super Agent** (or the AI section's prompt if Super Agent is set to "inherit").

## Streaming

Responses stream in token-by-token via Server-Sent Events. If your provider returns a 4xx for streaming, AnySpace falls back to a one-shot request and synthesizes a single delta — code paths don't branch.

You can abort a streaming response at any time with the **Stop** button next to the input — no orphaned tokens, no half-applied tool calls.

## Tools

Super Agent can call read and write tools to act on the workspace. Each tool call appears inline as a card with state (running, succeeded, failed, disabled, queued).

### Read tools

- `read_file`, `list_dir`, `git_status` — file and repo introspection.
- `get_terminal_context` — read the latest command + output from a pane (via OSC 133).
- `preview_detect` — see what dev server (if any) is detected.
- `read_team_messages` — read MESSAGES.md in a team workspace, with filters.

### Write tools

- `pty_write` — type into a specific terminal (no auto-newline).
- `new_tab`, `close_pane` — manipulate the workspace layout.
- `create_kanban_task` — file a task on the board.
- `append_team_message`, `team_broadcast`, `team_send_to_pane` — talk to team agents.
- `quick_suggest` — wrap Super Brain v1 to draft a "next command" for any pane.

### Trust mode

There is **no approval modal** for tool calls. Write tools execute immediately. Your audit surface is the inline tool-call card in the conversation, plus the **pause-tool-calls** toggle in the rail header (the red dot icon). With pause on, every tool call queues; you click Run or Skip on each card.

If a tool worries you, **disable it** in Settings → Super Agent → Tools. Disabled tools are stripped from the model's tool list, so it never even tries to call them. Disabled and queued tools both render as inert cards in the chat.

### Vision

Some tool calls (e.g. attaching a screenshot) require vision-capable models. Toggle **Vision** in Settings → Super Agent if your provider supports multimodal input. With it off, image inputs are silently dropped from the request.

## Voice into the rail

Hold the speech-to-text hotkey while the Super Agent input is focused, or while no other text input has focus and the rail is open — your dictation flows into the chat box. Release, edit if needed, hit Enter to send. See [Speech-to-text](/docs/ai/speech-to-text).

## Operator inbox handoff

When a [Team](/docs/team/team-mode) escalates to `@operator`, AnySpace shows a status-bar pill (`● N @operator`). Click it: the rail opens, an active session is ensured, and a single system message summarizes the unread messages — ready for you to respond. See [Operator inbox & tmsg](/docs/team/operator-tmsg).

## Settings inheritance

Every Super Agent setting can be left blank to inherit from **Settings → AI**:

| Field | If blank, falls back to |
|---|---|
| Endpoint | `ai.endpoint` |
| API key | `ai.apiKey` |
| Model | `ai.model` |
| System prompt | The AI section's prompt |

Most operators configure once in AI and never touch Super Agent's overrides.

## Reference

| Setting | Effect |
|---|---|
| Memory window | How many recent messages to send each turn |
| Max tool calls per turn | Hard cap on the ReAct loop length |
| Streaming | On by default; off forces one-shot |
| Tool toggles | Per-tool enable/disable |
| Vision | Allow image inputs |
| Panel width | Rail width in pixels (240–720) |

## Related

- [Configure your AI provider](/docs/ai/configure-ai)
- [Super Brain](/docs/ai/super-brain)
- [Speech-to-text](/docs/ai/speech-to-text)
- [Team mode](/docs/team/team-mode)
- [Operator inbox & tmsg](/docs/team/operator-tmsg)
- [Privacy & data handling](/docs/reference/privacy)
