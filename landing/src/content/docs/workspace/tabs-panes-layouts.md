---
title: Tabs, panes & layouts
description: How AnySpace organizes work into project-bound tabs, splittable panes, and pre-built layouts.
section: workspace
order: 10
updated: 2026-05-09
---

AnySpace's workspace is structured into **tabs**, each of which holds a tree of **panes**. A tab is bound to a project folder. A pane is a single terminal, editor, preview, mobile mirror, or file browser. You arrange panes by splitting and resizing, or by picking a layout template at tab creation.

## Tabs

Open a new tab from the title bar's **+** button or with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>T</kbd>. AnySpace asks for a project folder; this folder becomes the tab's working directory. Every terminal in the tab spawns there, every editor browses it, and Live Preview probes its `package.json` to detect the framework.

- Switch tabs with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>1</kbd>…<kbd>9</kbd>.
- Close the active tab with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>W</kbd>.
- Rename a tab by double-clicking the tab name.

If a tab belongs to a Team (see [Team mode](/docs/team/team-mode)), closing it auto-archives the team.

## Layout templates

When you create a new tab, the picker offers eight layout templates:

| Template | Cells | Best for |
|---|---|---|
| Solo | 1 | Single-pane focus |
| Pair | 2 | Code + run |
| Quad | 4 | Code, test, preview, logs |
| Squad | 6 | Mixed work + small dashboards |
| Pipeline | 8 | Long sequence of commands |
| Grid 3×3 | 9 | Multi-agent monitoring |
| Wide grid | 12 | Heavy dashboards |
| Mega grid | 16 | Maximum density (large displays only) |

Templates fix the initial structure; you can still split, swap, and close panes inside them.

## Splitting

Inside any pane:

- <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>D</kbd> — split horizontally (a new pane appears to the right).
- <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> — split vertically (a new pane appears below).

Each split halves the parent pane. Splits can be nested arbitrarily deep.

## Resizing

Drag the divider between two panes to resize. Sizes persist for the life of the tab. If you close a pane, neighboring panes redistribute the freed space.

## Drag-to-swap

Click and hold the **header** of a pane (the bar with the kind label and close button), then drag onto another pane. On release, the two panes swap positions. This works across splits at any depth — useful for re-arranging an 8-pane pipeline without closing and reopening anything.

> Note: pane drag uses native pointer events, not HTML5 drag, so it works inside iframes and on Linux Wayland.

## Closing

Click the × in a pane header, or right-click → **Close pane**. The pane's session is destroyed. If you close the last pane in a tab, the tab itself is closed.

## Why pane state survives

When you split, swap, or close a sibling pane, AnySpace **does not** unmount the surviving panes. They're rendered into stable hosts that get re-positioned in the layout tree, not re-created. That means:

- Terminal scrollback and PTY sessions persist.
- Monaco editor view state (cursor, folds, search) persists.
- Preview iframe history (back/forward) persists.

This is why an extensive 16-pane setup feels solid even when you re-arrange it mid-session.

## Reference

| Action | Shortcut |
|---|---|
| New tab | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>T</kbd> |
| Close tab | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>W</kbd> |
| Switch tab | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>1</kbd>…<kbd>9</kbd> |
| Split horizontal | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>D</kbd> |
| Split vertical | <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> |
| Swap panes | Drag pane header onto another pane |

## Related

- [Pane kinds](/docs/workspace/pane-kinds)
- [Multi-pane selection & broadcast](/docs/day-to-day/broadcast)
- [Keyboard shortcuts](/docs/reference/shortcuts)
