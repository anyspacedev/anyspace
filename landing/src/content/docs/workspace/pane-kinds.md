---
title: Pane kinds
description: A tour of every pane type — Terminal, Editor, Preview, Mobile, Files — and when to use each.
section: workspace
order: 20
updated: 2026-05-09
---

A pane is the smallest unit of the workspace. Every pane has a **kind** that determines what it shows. You can change a pane's kind from its header at any time without losing the pane's slot in the layout.

## Terminal

The default. A full-feature terminal backed by a real PTY (no Node sidecar — pure Rust + `portable-pty`).

- Bash and Zsh on macOS/Linux; Bash inside WSL on Windows.
- xterm.js with WebGL renderer (DOM fallback past 6 active terminals).
- OSC 133 shell-integration auto-injected — you don't configure anything.
- Each command becomes a [command block](/docs/day-to-day/terminal-blocks).

Use it for: anything you'd normally do in a shell.

## Editor

Monaco — the engine that powers VS Code — embedded as a pane.

- Open files via the file tree on the left, or with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>P</kbd> (fuzzy search).
- Find and replace with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>F</kbd> / <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>H</kbd>.
- Theme follows your AnySpace theme automatically.
- Multiple files open as tabs inside the pane.

Use it for: quick edits where opening your "main" editor would be overkill, or as one cell in a multi-pane workflow.

See [Editor](/docs/day-to-day/editor) for details.

## Preview

A live, framed preview of a local dev server.

- Auto-detects Vite, Next, Astro, SvelteKit, Nuxt, Remix from `package.json`.
- Probes conventional ports.
- Reload-on-file-change watcher with 150ms debounce.
- Device frame selector: Desktop, Tablet, iPhone 15, Fluid. Zoom 50–200%.
- Built-in [element picker](/docs/day-to-day/element-picker) — click an element, hand it to an AI agent.

Use it for: front-end work where you'd otherwise have a browser tab open beside your editor.

See [Live preview](/docs/day-to-day/live-preview) for caveats (X-Frame-Options, localhost only).

## Mobile

A mirror of an Android device or iOS Simulator.

- Android: needs `adb` + `scrcpy` on `PATH`. See [Setting up mobile preview](/docs/day-to-day/mobile-setup).
- iOS: macOS only. Uses Xcode's Simulator + ScreenCaptureKit.
- Captured frames push into the [screenshot stack](/docs/day-to-day/screenshot-stack), so you can drag a frame onto a terminal to attach it as input for an agent.

Use it for: testing mobile UIs in the same window as your code, or letting an agent see what's on the device screen.

See [Mobile pane](/docs/day-to-day/mobile-pane) for usage notes; setup is in a separate page.

## Files

A persistent file browser scoped to the tab's project folder.

- Open files into an Editor pane.
- Quick-look for non-text files.
- Drag a file path into a terminal to insert it at the cursor.

Use it for: navigating large projects you don't have memorized, or as a sidekick to a Terminal pane.

## Switching kinds

Click the kind label in a pane's header. The picker shows every kind. Switching destroys the previous kind's session (e.g. the terminal closes its PTY). Pane state inside the slot resets, but the slot itself stays put — your layout doesn't rearrange.

## Reference

| Kind | Backing tech | Survives layout changes? |
|---|---|---|
| Terminal | `portable-pty` + xterm.js | Yes |
| Editor | Monaco | Yes (view state) |
| Preview | `<iframe>` + watcher | Yes (history) |
| Mobile | scrcpy / SimCtl | Yes (connection) |
| Files | Tauri FS APIs | Yes |

## Related

- [Tabs, panes & layouts](/docs/workspace/tabs-panes-layouts)
- [Terminal & command blocks](/docs/day-to-day/terminal-blocks)
- [Live preview](/docs/day-to-day/live-preview)
- [Mobile pane](/docs/day-to-day/mobile-pane)
