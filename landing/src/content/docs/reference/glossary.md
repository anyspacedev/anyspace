---
title: Concepts glossary
description: Short definitions for the AnySpace-specific terms used throughout the docs.
section: reference
order: 60
updated: 2026-05-09
---

A quick lookup for AnySpace-specific terms. If a term is missing, it's probably standard usage from the broader ecosystem.

## A

**Agent** — A CLI program defined in AnySpace's Agents view, plus its system prompt and env vars. Agents are launched against tasks (see [Kanban & Run Task](/docs/team/kanban-run-task)) or as members of a [Team](/docs/team/team-mode).

**AnySpace Cloud** — Optional managed endpoint for AI and Speech-to-text. Sign in via Settings to use; entirely opt-in.

## B

**BOARD.md** — Shared markdown file in a team workspace at `.anyspace/teams/<id>/BOARD.md`. Holds the roster, task breakdown, and current status. Agents — usually the Coordinator — edit it.

**Block** — Short for **command block**. The discrete, hoverable unit AnySpace draws around each shell command and its output.

**Broadcast** — Mirroring keystrokes (or voice dictation) from the active terminal to every other selected pane in the same tab. See [Multi-pane selection & broadcast](/docs/day-to-day/broadcast).

## C

**Coordinator** — A built-in [Team mode](/docs/team/team-mode) role. Plans, tracks status, and acts as the primary contact point for the operator.

**Command block** — See **Block**.

## D

**Device frame** — Preview pane viewport size selector: Desktop, Tablet, iPhone 15, or Fluid.

## E

**Element picker** — A Live Preview tool that lets you click an element on the page and hand its source location + screenshot to an AI agent.

**Explain** — A per-block AI action that sends a command + output to your provider for a one-shot explanation. See [Explain a command block](/docs/ai/explain-blocks).

## K

**Kanban** — AnySpace's task board. Tracks tasks across Todo / In Progress / In Review / Complete columns. Tasks carry an agent assignment; **Run** spawns the agent against the task body.

## L

**Layout template** — Pre-built pane arrangement (1, 2, 4, 6, 8, 9, 12, 16 panes) you can pick when creating a tab.

**Live Preview** — A pane kind that embeds your local dev server in an iframe. Auto-detects framework, watches files, and supports the element picker.

## M

**MESSAGES.md** — Append-only log of inter-agent messages in a team workspace. Written via the `tmsg` shell function; periodically compacted into `MESSAGES.archive.md`.

## O

**Operator** — You. The human running the AnySpace app while agents do work. Agents address you as `@operator` when escalating.

**Operator inbox** — Status-bar pill that surfaces unread `@operator` messages from team agents. Clicking hands them to Super Agent.

**OSC 133** — Standard terminal escape sequence for shell-integration markers (prompt, command, output, end). AnySpace uses these to draw command blocks.

## P

**Pane** — Smallest unit of the workspace. One terminal, editor, preview, mobile mirror, or files browser. Multiple panes per tab.

**Pane kind** — The type of a pane (Terminal, Editor, Preview, Mobile, Files). You can change a pane's kind from its header without disturbing the layout.

## R

**Run Task** — The action that spawns an Agent's CLI in a fresh terminal pane against a Kanban task. See [Kanban & Run Task](/docs/team/kanban-run-task).

## S

**Screenshot stack** — Floating column of captured frames (from Preview or Mobile). Drag a thumbnail onto a terminal to attach the path. See [Screenshot stack](/docs/day-to-day/screenshot-stack).

**Session (Super Agent)** — One persistent conversation in Super Agent. Stored in SQLite, survives restart.

**STT** — Speech-to-text. AnySpace's hold-to-talk dictation system.

**Super Agent** — In-app multi-turn AI chat with streaming and tool calling. See [Super Agent](/docs/ai/super-agent).

**Super Brain** — One-shot keyboard-driven AI helper (<kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd>). Drafts a next-command suggestion into the active terminal without running it.

## T

**Tab** — Top-level workspace container. Bound to a project folder. Holds a tree of panes.

**Team** — Multi-agent workspace. A roster of CLI agents in parallel panes that coordinate via shared markdown files. See [Team mode](/docs/team/team-mode).

**`tmsg`** — Bash shell function injected into team panes. Lets agents send/receive messages, read the board, and request pane RPC. See [Operator inbox & tmsg](/docs/team/operator-tmsg).

**Trust mode** — Super Agent's default execution policy: tool calls run immediately without an approval modal. Pause via the rail header toggle, or disable specific tools in Settings.

## W

**WSL** — Windows Subsystem for Linux. Required on Windows for AnySpace's terminal panes — PowerShell and `cmd.exe` can't source the shell-integration script.

## Related

- [Welcome](/docs/get-started/welcome)
- [Troubleshooting](/docs/reference/troubleshooting)
