---
title: Editor
description: Monaco embedded as an AnySpace pane — fuzzy file search, find/replace, and theme inheritance.
section: day-to-day
order: 30
updated: 2026-05-09
---

The Editor pane runs Monaco — the same engine that powers VS Code. It's intended for quick edits without leaving AnySpace, not as a full IDE replacement. If you live in a different editor day-to-day, AnySpace's Editor is what you reach for when you want to stay in the multi-pane flow.

## Opening files

Three ways:

1. **File tree** on the left of the Editor pane. Click a file.
2. **Fuzzy search** with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>P</kbd>. Type any fragment of a filename.
3. **Drag from a terminal**. Drag a file path token from terminal output (or from the Files pane) into the Editor pane to open it.

Multiple open files appear as tabs at the top of the pane.

## Search & replace

| Action | Shortcut |
|---|---|
| Find | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>F</kbd> |
| Find & replace | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>H</kbd> |
| Find next | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>G</kbd> |
| Find previous | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> |

Standard Monaco — multi-cursor, regex, case-sensitive toggles all work.

## Save behavior

Editor saves to disk on <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>S</kbd>. There is no autosave by default. Unsaved tabs show a dot in the tab label.

## Themes

The Editor automatically follows your AnySpace theme. AnySpace derives a Monaco theme from the same color tokens that paint the rest of the UI, so switching themes in Settings updates the Editor in place — no restart, no flash.

See [Themes](/docs/reference/themes).

## Voice into the editor

If you hold the speech-to-text hotkey while an Editor pane is focused, the transcribed text is inserted **at the current cursor or selection** via Monaco's edit API — meaning undo/redo work normally and your cursor moves to the end of the inserted text. See [Speech-to-text](/docs/ai/speech-to-text).

## What the Editor does **not** do

- No language servers (no LSP, no IntelliSense beyond Monaco's built-in completions).
- No git gutter, no debug pane, no extension marketplace.
- No terminal — that's a separate pane kind.

If you need any of those, keep your "real" editor open in another window and use AnySpace's Editor for ad-hoc edits inside the agentic workflow.

## Reference

| Setting | Where |
|---|---|
| Theme | Settings → Appearance |
| File-tree project root | Tab's project folder (set at tab creation) |

## Related

- [Pane kinds](/docs/workspace/pane-kinds)
- [Themes](/docs/reference/themes)
- [Speech-to-text](/docs/ai/speech-to-text)
