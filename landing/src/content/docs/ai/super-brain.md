---
title: Super Brain (⌘⇧B)
description: One keystroke that drafts your next command into the terminal — no auto-execute, no chat.
section: ai
order: 20
updated: 2026-05-09
---

Super Brain is AnySpace's keyboard-driven AI helper. You press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> and AnySpace looks at the most recent command and output in the active terminal, asks the AI for what you should run next, and **writes the suggestion into the prompt without pressing Enter**. You review, edit, and run.

It's deliberately minimal — no chat history, no tools, no follow-up. One keystroke, one suggestion.

## When to use it

- You ran a test, it failed, and you want a likely next debug command.
- You ran `git status` and want a summary commit script.
- You typed something half-finished and want the AI to complete it.
- You have a command in mind but don't remember the exact flag.

If your task is more open-ended ("explain this codebase," "refactor X across these files"), use [Super Agent](/docs/ai/super-agent) instead.

## How to trigger

1. Focus a terminal pane.
2. Press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd>.
3. AnySpace types the suggestion at your prompt. Your cursor lands at the end.
4. Read it. Edit if needed. Press <kbd>Enter</kbd> to run, or <kbd>Ctrl</kbd> + <kbd>C</kbd> to discard.

The draft text is **never** committed to PTY input on AnySpace's behalf — only your manual <kbd>Enter</kbd> does that.

## Multi-pane parallel suggestions

If you have multiple terminals selected (Cmd-click their headers — see [Multi-pane selection & broadcast](/docs/day-to-day/broadcast)) when you press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd>:

1. AnySpace asks the AI for a tailored suggestion **per pane** in parallel, using each pane's own command history.
2. Each pane's PTY receives its own draft.
3. You press <kbd>Enter</kbd> once — broadcast fires it across every selected pane.

This is a fast way to fan out related-but-distinct commands across an N-pane setup, e.g. running per-service test suites with different env vars.

## What the model sees

For each terminal, AnySpace sends:

- The system prompt from Settings → AI.
- The most recent finished command and its output (from the OSC 133 block boundaries).
- The current shell, OS, and the tab's project directory.

It does **not** see your full scrollback or any other panes. The context is small on purpose — fast and cheap.

## Configuring the system prompt

You can tune Super Brain's behavior by editing the system prompt in **Settings → AI**. The same prompt is used for the **Explain** block action, so changes affect both. Common tweaks:

- "Always reply with a single shell command and no commentary."
- "Prefer macOS-flavored commands."
- "If unsure, return a `# comment` instead of a guess."

## Why no auto-execute?

This is a hard rule. The draft is sanitized (code fences and leading `$` are stripped) and written without a trailing newline so it can never run on its own — even if a prompt-injection attack tried to slip an Enter into the AI's response. You always press Enter yourself. See [Privacy & data handling](/docs/reference/privacy) for the broader stance.

## Reference

| Action | Shortcut |
|---|---|
| Trigger Super Brain | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> |
| Discard draft | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| Configure model + prompt | Settings → AI |

## Related

- [Configure your AI provider](/docs/ai/configure-ai)
- [Super Agent](/docs/ai/super-agent)
- [Multi-pane selection & broadcast](/docs/day-to-day/broadcast)
