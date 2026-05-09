---
title: Welcome
description: What AnySpace is, who it is for, and how it differs from a plain terminal.
section: get-started
order: 10
updated: 2026-05-09
---

AnySpace is an agentic workspace for software builders. It bundles a multi-pane terminal, a code editor, a live preview, mobile mirroring, and an in-app AI assistant into a single Tauri desktop app. The goal is to keep everything you need to ship a feature inside one window, with AI agents that can see what you see and act on the same surfaces you do.

If you have used Warp, iTerm + tmux, or VS Code's terminal — AnySpace overlaps with each of them but stitches the parts together differently. Commands run as discrete blocks. Panes survive layout changes. AI assistants can read terminal output, write into a PTY, and spawn whole tabs full of collaborating agents.

## Who it is for

- **Solo developers** who like keyboard-driven workflows and want an AI that lives next to their work, not in a separate browser tab.
- **Founders & operators** running a small fleet of AI coding agents and tired of context-switching between tmux, Slack, and a chat UI.
- **Teams piloting agentic workflows** — AnySpace's Team mode is built around multi-agent coordination via shared markdown files.

## What is unique

- **Command blocks.** Every command you run becomes a self-contained block with rerun, copy, and "explain with AI" actions, automatically — no manual setup.
- **Multi-pane parallelism.** Cmd-click to multi-select panes, then type once and broadcast to every selected terminal. Voice input works the same way.
- **Two AI surfaces.** A one-shot keyboard-driven helper (Super Brain, ⌘⇧B) drafts your next command without running it. A multi-turn chat (Super Agent) holds a conversation, calls tools, and can manipulate your workspace.
- **File-based agent collaboration.** Team mode runs multiple CLI agents in parallel panes that talk to each other through a shared `BOARD.md` and `MESSAGES.md`. No central server.

## Where to go next

- **New here?** [Install](/docs/get-started/install), then take the [Quick tour](/docs/get-started/quick-tour).
- **Already installed?** Skim [Tabs, panes & layouts](/docs/workspace/tabs-panes-layouts) and [Terminal & command blocks](/docs/day-to-day/terminal-blocks).
- **Bringing a team?** Jump to [Team mode](/docs/team/team-mode).
- **Stuck?** [Troubleshooting](/docs/reference/troubleshooting) has the common gotchas.
