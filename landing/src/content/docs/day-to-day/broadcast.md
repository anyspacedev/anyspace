---
title: Multi-pane selection & broadcast
description: Type once, broadcast keystrokes to every selected terminal in the same tab.
section: day-to-day
order: 20
updated: 2026-05-09
---

When you have multiple terminals open in a tab and want to do the same thing in all of them — install deps, restart a server, run a probe — AnySpace's multi-pane broadcast lets you type once and fan the keystrokes to every selected terminal. Voice input works the same way.

## Selecting panes

- <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>-click a pane header to add or remove it from the current selection.
- Selected panes get a visible accent border.
- Press <kbd>Esc</kbd>, click an empty area, or switch tabs to clear the selection.

A single-pane "selection" of one terminal short-circuits the broadcast logic — your keystrokes go only to that terminal as normal.

## How broadcast works

Once two or more terminals are selected:

1. Type into the active terminal as you normally would.
2. Every keystroke is mirrored to the PTY of every other selected terminal in the same tab.
3. Output from each terminal stays separate — only **input** is shared.

This means every selected pane sees the same characters, but they may diverge in output (different shells, different cwd, different prior state).

## Press Enter once, run everywhere

The same broadcast applies to <kbd>Enter</kbd>. So if you type:

```
git pull
```

…then press <kbd>Enter</kbd> with five terminals selected, each one runs `git pull` in its own working directory. This is the fastest way to fan out a command across a multi-agent workspace.

## Voice broadcast

Speech-to-text obeys the same selection. With two or more terminals selected, dictation is fanned to every selected pane (without a trailing newline — review and Enter to run). See [Speech-to-text](/docs/ai/speech-to-text).

## Super Brain across selected panes

If you press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> with multiple panes selected, AnySpace asks the AI for a tailored "next command" for **each** pane independently — based on each pane's own command history — and writes the per-pane suggestion into each PTY. You then press <kbd>Enter</kbd> once to run all of them in parallel. See [Super Brain](/docs/ai/super-brain).

## Why no auto-newline?

Broadcasting keystrokes is a powerful tool and an obvious foot-gun. AnySpace deliberately writes drafts (from voice, from Super Brain, from Super Agent) **without** an automatic newline. You always review and press Enter to run. The only newlines that get broadcast are the ones you type yourself.

## In Team mode

If a tab belongs to a [Team](/docs/team/team-mode), voice dictation has an additional behavior: with no explicit multi-pane selection, dictation fans to every team-pane PTY by default. With an explicit selection, the selection wins and only those panes receive input.

## Reference

| Action | Shortcut |
|---|---|
| Add/remove pane from selection | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>-click pane header |
| Clear selection | <kbd>Esc</kbd>, click background, or switch tabs |

## Related

- [Tabs, panes & layouts](/docs/workspace/tabs-panes-layouts)
- [Speech-to-text](/docs/ai/speech-to-text)
- [Super Brain](/docs/ai/super-brain)
- [Team mode](/docs/team/team-mode)
