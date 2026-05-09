---
title: Terminal & command blocks
description: How AnySpace turns every command into a discrete block, and what you can do with each one.
section: day-to-day
order: 10
updated: 2026-05-09
---

A **command block** is AnySpace's atomic unit of terminal history. Every time you press Enter, the command and its output are wrapped into a self-contained block that you can rerun, copy, or hand to AI. Blocks are not a separate "mode" — they appear over a normal terminal automatically.

## How blocks work

AnySpace injects a small shell-integration script into every Bash/Zsh session it spawns. The script emits standard **OSC 133** escape sequences around each command — A (prompt), B (command), C (output), D (end). Those markers tell the renderer where one command ends and the next begins.

You don't configure this. You don't source anything. It works the first time you launch a terminal. (On Windows, your shell runs inside WSL where Bash is available — see [Install](/docs/get-started/install).)

If your shell isn't Bash or Zsh, blocks won't render — you'll see a normal scrollback. The terminal still works.

## Block actions

Hover any block to see the action row in its top-right corner:

| Action | What it does |
|---|---|
| **Rerun** | Re-executes the command at the current prompt |
| **Copy command** | Copies just the command line |
| **Copy output** | Copies just the captured output |
| **Copy as Markdown** | Copies a fenced markdown bundle of command + output, ready for a chat or doc |
| **Explain** | Sends the command + output to your AI provider for a one-shot explanation. See [Explain a command block](/docs/ai/explain-blocks). |

Keyboard shortcuts:

| Action | Shortcut |
|---|---|
| Copy command | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>C</kbd> |
| Copy output | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>O</kbd> |
| Copy as Markdown | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>M</kbd> |

## Navigating blocks

Long sessions can have hundreds of blocks. Step through them with:

| Action | Shortcut |
|---|---|
| Previous block | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>[</kbd> |
| Next block | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>]</kbd> |

The terminal scrolls to align the block at the top of the viewport.

## Status & exit codes

Each block's left edge tints by status:

- **Running** — pulsing accent.
- **Success** — neutral border (matches theme).
- **Failure** — red tint when the command exited non-zero.

Hover the block header to see the exit code and duration.

## Selecting text inside blocks

Blocks don't change selection behavior. Drag-select inside a block to copy text the normal way. The block boundaries are visual; the underlying scrollback is a continuous xterm buffer.

## When blocks misbehave

If a long-running command produces output but never sends a newline (some progress indicators), the block stays "running" until the next OSC 133 D arrives. This is rare and harmless.

If you SSH into a remote machine that doesn't have AnySpace's shell integration, blocks pause: the local prompt's blocks resume once you exit the remote session.

## Reference

The shell-integration script lives at `$TMPDIR/anyspace-shell-integration/integration.sh`. AnySpace sets `BASH_ENV` so every spawned shell sources it. You should never need to touch this file.

## Related

- [Multi-pane selection & broadcast](/docs/day-to-day/broadcast)
- [Explain a command block](/docs/ai/explain-blocks)
- [Super Brain (⌘⇧B)](/docs/ai/super-brain)
- [Troubleshooting](/docs/reference/troubleshooting)
