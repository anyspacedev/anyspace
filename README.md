# Teamship

> orchestrate AI agents across multi-pane workspaces, manage tasks visually, and ship from one native app

A Tauri v2 + React 19 desktop app — terminal multiplexer, code editor, live browser preview, and Kanban-driven agent launcher in one window.

## Highlights

- **Multi-pane terminals (1–16)** powered by `xterm.js` + WebGL renderer + a Rust `portable-pty` backend
- **Warp-style command blocks** captured via OSC 133 shell-integration sequences (bash + zsh)
- **Monaco editor pane** with Cmd+P fuzzy file search
- **v0.dev-style live preview pane** — auto-detects local dev servers (Vite, Next, Astro, SvelteKit, Nuxt, Remix), reloads on file changes, device frames (Desktop / Tablet / iPhone 15 / Fluid), zoom 50–200%
- **Kanban board** with @dnd-kit; click *Run Task* and a fresh pane spawns with the agent CLI auto-fired and task context injected via temp file + `$TEAMSHIP_TASK_FILE`
- **5 themes** (Void, Dracula, Synthwave, Paper, Solar), CSS-variable driven with mirrored xterm + Monaco palettes
- **SQLite persistence** for tasks, agents, prompts, and saved workspace layouts

## Stack

| | |
|---|---|
| Shell | Tauri v2 (Rust) |
| Frontend | React 19, TypeScript, Vite |
| Terminal | `@xterm/xterm` v5 + WebGL/Fit/Clipboard/Serialize addons |
| PTY | `portable-pty` (cross-platform: Unix PTY + Windows ConPTY) |
| Streaming | `tauri::ipc::Channel<Vec<u8>>` per session |
| Editor | `@monaco-editor/react` + bundled `monaco-editor` |
| State | Zustand |
| Persistence | `tauri-plugin-sql` (sqlite) |
| Layout | `react-resizable-panels` |
| DnD | `@dnd-kit/core` |
| File watcher | `notify` + `notify-debouncer-mini` |
| Updater | `tauri-plugin-updater` |

## System requirements

| Platform | Minimum |
|---|---|
| **Linux** | Debian 12 / Ubuntu 22.04+ (needs `glib-2.0 >= 2.70`, WebKitGTK 6, GTK 4) |
| **macOS** | 11 Big Sur+ |
| **Windows** | 10 (build 1809+) with WebView2 |

You also need:
- Node ≥ 20 + npm (or pnpm)
- Rust ≥ 1.77 (`rustup default stable`)

> **Note:** This dev box ships with GLib 2.66 (Debian 11), which is below Tauri 2's minimum. Build on a modern distro. The frontend bundle compiles fine here (validated with `npx tsc --noEmit` and `npx vite build`).

## Setup

```bash
# 1. Install JS deps
npm install

# 2. Run in dev mode (hot reload + Rust watcher)
npm run tauri:dev

# 3. Production bundle (.deb / .AppImage / .dmg / .msi depending on host)
npm run tauri:build
```

## Project structure

```
app/
├── src/                            # React 19 frontend
│   ├── App.tsx
│   ├── main.tsx
│   ├── components/
│   │   ├── workspace/              # TabBar, Sidebar, PaneGrid, Pane, PaneHeader, TemplatePicker, StatusBar, WorkspaceView
│   │   ├── terminal/               # Terminal.tsx + osc133.ts + CommandBlocks.tsx
│   │   ├── editor/                 # Monaco wrapper + language map
│   │   ├── preview/                # PreviewPane + Toolbar + DeviceFrame  ← v0.dev-style
│   │   ├── sidebar/                # FileBrowser + QuickOpen (Cmd+P)
│   │   ├── kanban/                 # Board + Column + Card + TaskEditor
│   │   ├── agents/                 # AgentManager (CRUD)
│   │   └── settings/               # Theme picker + keyboard ref
│   ├── stores/                     # Zustand: workspace, theme, kanban
│   ├── themes/                     # 5 theme definitions + CSS-var application
│   ├── lib/                        # Typed Tauri invoke wrappers + shortcuts
│   ├── styles/                     # tokens.css + globals.css + layout.css
│   └── lib/types.ts
├── src-tauri/                      # Rust backend
│   ├── src/
│   │   ├── lib.rs                  # tauri::Builder, plugin & command registration
│   │   ├── pty/                    # portable-pty + Channel streaming + commands
│   │   ├── shell_integration/      # OSC 133 init script (bash/zsh)
│   │   ├── preview/                # Port detection + notify watcher + commands
│   │   ├── kanban/                 # SQL migrations
│   │   ├── agent/                  # Task-context file builder + agent_launch
│   │   ├── fs_ops/                 # Recursive directory listing
│   │   ├── settings/               # JSON-file-backed settings
│   │   └── workspace/              # Layout persistence
│   ├── migrations/                 # 001_init.sql, 002_seed.sql
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── capabilities/default.json
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| ⌘T | New workspace tab |
| ⌘W | Close current tab |
| ⌘P | Quick Open (file search) |
| ⌘D | Split pane horizontally |
| ⌘⇧D | Split pane vertically |
| ⌘1–9 | Switch to tab N |
| ⌘S | Save file (in editor pane) |
| ⌘F | Search in terminal |

## Agent flow

1. Define an agent in **Agents** with a `command` template — placeholders: `{task_file}` or `$TEAMSHIP_TASK_FILE`.
2. Create a task in **Tasks**, attach an agent + project path.
3. Hit **Run Task**. Teamship:
   - Writes the task title + body + system prompt to `/tmp/teamship-tasks/task-<uuid>.md`
   - Spawns a new workspace tab with one terminal pane in the project's `cwd`
   - Sets `TEAMSHIP_TASK_FILE` env var on the PTY
   - Waits for the first OSC 133 prompt-start, then types the resolved command + Enter
4. The agent's output streams through xterm with command-block segmentation.

## Live preview flow

1. Add a **Preview** pane to a workspace (pane header → kind switcher).
2. Click *Watch folder*, pick your project root.
3. Teamship reads `package.json` to identify framework, then probes conventional ports (5173, 3000, 4321, 4173, 8080…).
4. The detected URL renders inside an iframe wrapped in your selected device frame.
5. A `notify` watcher (debounced 150ms; ignores `node_modules`, `.git`, `dist`, `.next`, `target`, `.turbo`) emits `preview:reload:<paneId>`; the pane reloads.

> **Cross-origin previews:** the current MVP uses `<iframe>`. Most localhost dev servers don't set `X-Frame-Options`, so this works out of the box for Vite/Next/Astro. For sites that block iframes, the planned step is a Tauri native child WebView — already scaffolded in the capabilities config but not yet wired (tracked in plan).

## Status

This is the MVP scaffold. All 13 build phases complete (validated by `tsc --noEmit` and `vite build`). Outstanding work, from the plan:

- Bundle real icons before `tauri build` (Tauri requires PNG/ICNS/ICO in `src-tauri/icons/`)
- 20 more themes (foundation supports them; just data)
- Cmd+F in-terminal search styling
- Updater endpoint signing key + hosting
- Real macOS / Windows bundle verification (only Linux is testable here, and only on glibc-modern systems)
