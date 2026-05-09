---
title: Element picker
description: Click any element in the live preview, hand it to an AI agent, and ask for changes.
section: day-to-day
order: 50
updated: 2026-05-09
---

The element picker turns Live Preview into a visual hand-off to an AI agent. Click an element on the page; AnySpace captures its tag, classes, text, and (when available) the source-file location. From there you can spawn an agent to implement a change, or queue the work as a Kanban task.

## Turning it on

In a Preview pane, click the crosshair icon in the header. Your cursor becomes a picker. Hover any element — it gets highlighted. Click it to capture. Click the crosshair again (or press <kbd>Esc</kbd>) to turn off the picker.

## What gets captured

For the picked element, AnySpace records:

- The tag name and CSS classes.
- Trimmed inner text (truncated for very long content).
- The element's bounding rect and viewport size at capture time.
- The source file and line number, if your dev server exposes React DevTools metadata (`_debugSource`).

The picker also takes a screenshot of the picked element and pushes it to the [screenshot stack](/docs/day-to-day/screenshot-stack), so you have a visual reference even after the page reloads.

## What you can do with a capture

After clicking an element, AnySpace presents two actions:

- **Run now** — opens a new pane in the current tab, spawns the active agent, and seeds the prompt with your captured element + a free-form description of the change you want.
- **Add to Kanban & run** — does the same, but also creates a tracked Kanban task so the work shows up on your board. See [Kanban & Run Task](/docs/team/kanban-run-task).

In both cases, the agent receives the element's source location and screenshot as part of its task file, so it knows exactly what you clicked.

## How it works under the hood

The Preview iframe is a different origin from AnySpace itself, so direct DOM access is blocked. The picker injects a small script into every iframe at document-start, and the parent communicates with it via `postMessage`. You don't need to install anything for this to work — it's automatic.

If your dev server reloads (e.g. you saved a file mid-pick), the picker re-arms automatically once the iframe finishes loading.

## Tips

- Pick the smallest meaningful element. Picking a wrapping `<div>` gives the agent less context than picking the actual button or label.
- The "Run now" path is great for one-shot tweaks. "Add to Kanban & run" is better if you want the work tracked and reviewable.
- If your component framework strips the `_debugSource` metadata in production, the picker still works — it just won't include a source-file hint.

## Reference

| Setting | Where |
|---|---|
| Active agent (used for Run now) | Kanban → Agents picker |
| Screenshot stack | Lower-left floating column |

## Related

- [Live preview](/docs/day-to-day/live-preview)
- [Kanban & Run Task](/docs/team/kanban-run-task)
- [Screenshot stack](/docs/day-to-day/screenshot-stack)
