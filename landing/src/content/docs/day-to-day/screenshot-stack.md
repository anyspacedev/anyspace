---
title: Screenshot stack
description: A clipboard-like column of captured frames you can drag onto a terminal to attach as agent input.
section: day-to-day
order: 80
updated: 2026-05-09
---

The screenshot stack is a floating column on the lower-left of the workspace that holds frames captured from the [Live preview](/docs/day-to-day/live-preview) and [Mobile](/docs/day-to-day/mobile-pane) panes. It's a quick, visual way to give an AI agent a picture of "this thing I'm looking at."

## What goes on the stack

- Preview pane → camera button → captures a screenshot of the current iframe.
- Element picker → captures a screenshot of the picked element.
- Mobile pane → camera button → captures the current device frame.

Every capture appears as a thumbnail card at the top of the stack. Newer captures push older ones down.

## How to use a screenshot

Drag a thumbnail from the stack onto **any terminal pane**. AnySpace inserts the screenshot's file path into the terminal at the cursor position. Critically, it **does not** press Enter — you review what was inserted and decide what to do next.

The most common pattern is to attach screenshots to AI agent input. For example, with a Kanban-spawned Claude Code or Codex agent open in a terminal:

1. Capture the buggy element from the Preview pane.
2. Drag the screenshot card onto the terminal.
3. Type "fix this layout bug" after the path.
4. Press Enter.

The agent reads the file from disk and works against it.

## Removing items

Hover a thumbnail and click the × in its corner to remove it. Or drag it off the stack into empty space.

## Persistence

The screenshot stack is **session-only**. It does not persist across app restarts. The underlying image files live in a temp directory that AnySpace cleans up when the app exits.

## Keyboard fallback

The stack uses native pointer events for drag, not HTML5 drag — this avoids issues with WebView and iframes. For keyboard users, click a thumbnail to copy its file path to the clipboard, then paste into a terminal manually.

## Privacy

Screenshots taken from Live Preview or Mobile never leave your machine through AnySpace itself. If you drag a screenshot into a terminal that's running a cloud AI agent, the agent reads the file as part of its input — at that point, the cloud provider sees it. See [Privacy & data handling](/docs/reference/privacy).

## Related

- [Live preview](/docs/day-to-day/live-preview)
- [Element picker](/docs/day-to-day/element-picker)
- [Mobile pane](/docs/day-to-day/mobile-pane)
- [Privacy & data handling](/docs/reference/privacy)
