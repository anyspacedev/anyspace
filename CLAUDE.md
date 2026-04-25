# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install                  # install JS deps (Cargo handles its own on first build)
npm run tauri:dev            # dev: Vite on :1420 + cargo run with hot reload
npm run tauri:build          # bundle .deb / .AppImage / .dmg / .msi (host-dependent)

npx tsc --noEmit             # frontend typecheck (CI gate)
npx vite build               # frontend production bundle into dist/
cd src-tauri && cargo check  # Rust typecheck (faster than build)
cd src-tauri && cargo build  # full debug build → src-tauri/target/debug/teamship
```

**System floor:** Tauri 2 needs `glib-2.0 >= 2.70` (Debian 12 / Ubuntu 22.04+), Rust ≥ 1.77, Node ≥ 20.

`tauri::generate_context!()` reads `src-tauri/icons/*` at **compile time** — those files must exist or `cargo check` panics with "failed to open icon".

## Architecture

Tauri v2 desktop app (Rust backend + React 19 / Vite frontend) implementing a multi-pane terminal multiplexer with Warp-style command blocks, Monaco editor, v0.dev-style live preview, and a Kanban-driven AI agent launcher.

### IPC contract is the spine

Every Rust command in `src-tauri/src/*/commands.rs` has a typed wrapper in `src/lib/tauri.ts`. **Adding a Rust command requires three coordinated changes:**

1. `#[tauri::command]` function in the appropriate module
2. Register it in `tauri::generate_handler![...]` inside `src-tauri/src/lib.rs`
3. Grant permission in `src-tauri/capabilities/default.json` (and add a `tauri.ts` wrapper)

Skip any of these and the command silently fails at runtime.

### PTY streaming uses Channels, not events

`tauri::ipc::Channel<Vec<u8>>` carries terminal output from the Rust reader thread to the React side. Each `pty_spawn` call accepts a frontend-allocated `Channel`; Rust spawns a `std::thread` that pumps `portable_pty::Reader` → 4KB chunks → `channel.send`. Don't switch to `app.emit()` for PTY data — it serializes through every listener.

`portable-pty` is used instead of `node-pty` (mentioned in marketing copy). It's pure Rust, ships in the binary, and uses ConPTY on Windows automatically. **Do not** introduce a Node sidecar.

### OSC 133 is auto-injected, not opt-in

`src-tauri/src/shell_integration/scripts.rs` writes a bash/zsh integration script to `$TMPDIR/teamship-shell-integration/integration.sh` on first PTY spawn. The script is sourced via the `BASH_ENV` env var that `pty_spawn` sets on every child process — every shell session emits OSC 133 A/B/C/D sequences without user opt-in.

Frontend parses those sequences in `src/components/terminal/osc133.ts` (`registerOscHandler(133, …)`) and overlays absolute-positioned `<div>` markers on top of xterm via `CommandBlocks.tsx`. The overlay reads `terminal.buffer.active.baseY + cursorY` to anchor blocks to absolute scrollback rows — the position-syncing math in `Terminal.tsx`'s `updateGeom` is load-bearing.

### Layout is a recursive split/leaf tree

`src/lib/types.ts` defines `LayoutNode = { type: "leaf", paneId } | { type: "split", direction, sizes, children }`. The store in `src/stores/workspaceStore.ts` mutates this tree for splits and pane closes — **renormalizing `sizes` after removal** is critical or the resize handles drift. `buildLayout(paneCount, ids)` synthesizes the canonical 1/2/4/6/8/9/12/16 templates.

`PaneGrid.tsx` recursively maps the tree to nested `<PanelGroup>` from `react-resizable-panels`. The `path: number[]` argument tracks the position so resize callbacks can set sizes at the right depth via `setSizesAtPath`.

### Pane kinds are a closed discriminated union

Adding a new `PaneKind` requires updates in **all** of:
- `src/lib/types.ts` (the union)
- `src/components/workspace/Pane.tsx` (the switch in `PaneBody`)
- `src/components/workspace/PaneHeader.tsx` (`KIND_LABELS` and `KIND_ICONS`)

Forgetting any one leaves dead branches; TS catches the union but not the icon/label maps.

### Run Task flow

`KanbanBoard.runTask` →
1. `agent_launch` (Rust) writes task body + system prompt to `/tmp/teamship-tasks/task-<uuid>.md`, substitutes `{task_file}` in the agent's command template, returns `{ command, taskFile, env }`.
2. Frontend creates a new workspace tab with one terminal pane and stashes `{ pendingCommand, ... }` in pane payload.
3. `Terminal.tsx`'s `useEffect` sees `pendingCommand`, waits 600ms for the shell prompt to settle, then writes the command + `\n` to the PTY and clears `pendingCommand`.

The `TEAMSHIP_TASK_FILE` env var is **only** set if you wire it via the agent's stored `envJson` field — `agent_launch` returns it in `env` but the current spawn path doesn't merge that into `pty_spawn`'s env. Either substitute via `{task_file}` in the command, or extend `runTask` to pass env through.

### SQLite schema gotcha

The `tasks` table column is `column_name`, not `column`. SQLite tolerates `column` as an identifier in some contexts but it's a reserved word and `tauri-plugin-sql`'s parser bails. The `Task["column"]` TS field stays `column` — `kanbanStore.ts` translates with `rowToTask`.

Migrations live in `src-tauri/migrations/*.sql` and are registered in `src-tauri/src/kanban/db.rs` via `MigrationKind::Up`. They run automatically on `Database.load("sqlite:teamship.db")`.

### Theme system

A `Theme` (`src/themes/definitions.ts`) bundles three palettes: UI tokens (CSS vars), a full xterm.js `ITheme`, and via `monacoThemeFor()` a Monaco theme derived from those tokens. `applyTheme()` writes CSS custom properties to `:root` and stamps `data-theme` / `data-theme-kind`. `Terminal.tsx` and `Editor.tsx` both subscribe to `useThemeStore` and re-apply on change — themes hot-swap without restart.

Adding a theme = one entry in `definitions.ts`. The 5 shipping themes (Void, Dracula, Synthwave, Paper, Solar) are foundational; the spec calls for 25+, all data-only.

### Live preview

`src/components/preview/PreviewPane.tsx` uses an `<iframe>` (not a Tauri child WebView yet). It works for localhost dev servers because they don't set `X-Frame-Options`. `preview_detect` reads `package.json` to identify the framework, then probes conventional ports — see `src-tauri/src/preview/detector.rs` for the priority lists. `preview_watch_start` spawns a `notify-debouncer-mini` (150ms) that emits `preview:reload:<paneId>` events, consumed by `useEffect` in `PreviewPane`.

### Frontend state

Five Zustand stores in `src/stores/`. None are global singletons that auto-load — `App.tsx`'s mount effect explicitly calls `themeStore.load()` and `kanbanStore.load()`. Forgetting to await `load()` before reading is a common pitfall (the stores expose `loaded: boolean`).

### Build artifacts

`src-tauri/gen/` (gitignored) is regenerated by Tauri from `tauri.conf.json` on every build — do not edit. `src-tauri/icons/` are placeholder purple PNGs; replace before any release bundle.
