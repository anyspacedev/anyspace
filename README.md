# AnySpace

> Orchestrate AI agents across multi-pane workspaces, manage tasks visually, and ship from one native app.

A Tauri v2 + React 19 desktop app — terminal multiplexer, code editor, live browser preview, and Kanban-driven agent launcher in one window.

📖 **Docs:** [anyspace.dev/docs](https://anyspace.dev/docs)

## Features

- Multi-pane terminals (1–16) via `xterm.js` + `portable-pty`
- Warp-style command blocks via OSC 133 shell integration (bash + zsh)
- Monaco editor with Cmd+P fuzzy file search
- Live preview pane — auto-detects local dev servers (Vite, Next, Astro, SvelteKit, Nuxt, Remix), reloads on file changes, device frames + zoom
- Kanban board with *Run Task* — spawns a pane with the agent CLI auto-fired and task context injected via `$ANYSPACE_TASK_FILE`
- Themes (Void, Dracula, Synthwave, Paper, Solar) with mirrored xterm + Monaco palettes
- SQLite persistence for tasks, agents, prompts, and layouts

## Requirements

- **Linux:** Debian 12 / Ubuntu 22.04+ (`glib-2.0 >= 2.70`, WebKitGTK 6, GTK 4)
- **macOS:** 11+
- **Windows:** 10 (1809+) with WebView2
- Node ≥ 20, Rust ≥ 1.77

## Setup

```bash
npm install
npm run tauri:dev      # dev mode (hot reload)
npm run tauri:build    # bundle .deb / .AppImage / .dmg / .msi
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘T / ⌘W | New / close tab |
| ⌘P | Quick Open |
| ⌘D / ⌘⇧D | Split pane horizontally / vertically |
| ⌘1–9 | Switch to tab N |
| ⌘S | Save file (editor pane) |
| ⌘F | Search in terminal |

## Agent flow

1. Define an agent with a `command` template using `{task_file}` or `$ANYSPACE_TASK_FILE`.
2. Create a task, attach the agent + project path.
3. Hit **Run Task** — AnySpace writes the task to `/tmp/anyspace-tasks/task-<uuid>.md`, spawns a pane in the project cwd, and runs the resolved command after the first prompt.
