---
title: Keyboard shortcuts
description: A complete cheat sheet for every keyboard shortcut in AnySpace.
section: reference
order: 20
updated: 2026-05-09
---

Every shortcut in AnySpace, grouped by what it acts on. <kbd>Cmd</kbd> on macOS, <kbd>Ctrl</kbd> elsewhere unless noted otherwise.

## Tabs

| Action | Shortcut |
|---|---|
| New tab | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>T</kbd> |
| Close tab | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>W</kbd> |
| Switch to tab N | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>1</kbd>…<kbd>9</kbd> |
| New team | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> |

## Panes

| Action | Shortcut |
|---|---|
| Split horizontal | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>D</kbd> |
| Split vertical | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> |
| Add/remove from selection | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd>-click pane header |
| Clear selection | <kbd>Esc</kbd> |
| Swap panes | Drag pane header onto another pane |

## Editor

| Action | Shortcut |
|---|---|
| Fuzzy file search | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>P</kbd> |
| Find | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>F</kbd> |
| Find & replace | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>H</kbd> |
| Find next | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>G</kbd> |
| Save | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>S</kbd> |

## Command blocks

| Action | Shortcut |
|---|---|
| Previous block | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>[</kbd> |
| Next block | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>]</kbd> |
| Copy command | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>C</kbd> |
| Copy output | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>O</kbd> |
| Copy as Markdown | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Alt</kbd> + <kbd>M</kbd> |

## AI

| Action | Shortcut |
|---|---|
| Super Brain (next-command draft) | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> |
| Discard Super Brain draft | <kbd>Ctrl</kbd> + <kbd>C</kbd> |
| Open Super Agent rail | UI: click rail tab on right edge |
| Stop streaming response | UI: Stop button next to input |

## Speech-to-text

| Action | Default shortcut |
|---|---|
| Hold to record | <kbd>Right Ctrl</kbd> (Linux/Win), <kbd>Right Alt</kbd> (macOS) |

The hotkey is fully rebindable in **Settings → Speech-to-text**.

## Theme

| Action | Shortcut |
|---|---|
| Toggle dark/light variant | UI: title bar sun/moon icon |

## Rebinding

Settings → **Keyboard** lists every rebindable action. Click a binding, press the new combination, and AnySpace records it. Conflicts (two actions on the same key) are flagged with a warning; resolve before closing Settings.

Bindings are stored under the `keybindings` key in `settings.json`, which lives at:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/AnySpace/settings.json` |
| Linux | `~/.config/AnySpace/settings.json` |
| Windows | `%AppData%\AnySpace\settings.json` |

## Related

- [Tabs, panes & layouts](/docs/workspace/tabs-panes-layouts)
- [Terminal & command blocks](/docs/day-to-day/terminal-blocks)
- [Speech-to-text](/docs/ai/speech-to-text)
- [Settings & data](/docs/reference/settings-data)
