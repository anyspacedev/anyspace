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
3. Grant permission in `src-tauri/capabilities/default.json` *(only required when the command comes from a Tauri plugin — project-defined commands are covered by `core:default`)*, and add a `tauri.ts` wrapper.

Skip any of these and the command silently fails at runtime.

Commands that need to read settings, build proxy-aware HTTP clients, or emit events should take `app: tauri::AppHandle` as their first parameter (Tauri injects it automatically — no frontend change needed). Several commands already follow this convention (`preview_detect`, `preview_can_frame`, `stt_transcribe`, `ai_chat`).

### PTY streaming uses Channels, not events

`tauri::ipc::Channel<Vec<u8>>` carries terminal output from the Rust reader thread to the React side. Each `pty_spawn` call accepts a frontend-allocated `Channel`; Rust spawns a `std::thread` that pumps `portable_pty::Reader` → 4KB chunks → `channel.send`. Don't switch to `app.emit()` for PTY data — it serializes through every listener.

`portable-pty` is used instead of `node-pty` (mentioned in marketing copy). It's pure Rust, ships in the binary, and uses ConPTY on Windows automatically. **Do not** introduce a Node sidecar.

**xterm WebGL is capped at 6.** Browsers limit total active WebGL contexts (Chromium ~16, WebKit ~8) and silently evict the oldest when the limit is hit — which spams console errors and corrupts other terminals. `Terminal.tsx` tracks `activeWebglTerminals` and falls back to xterm's DOM renderer past `MAX_WEBGL_TERMINALS = 6`. Don't raise the cap without testing eviction behavior on Linux/Chromium.

**Renderer dimensions race.** xterm's `_core._renderService.dimensions` getter crashes if read before the first paint. Any code that touches it (block-overlay geometry, fit-addon math) must `try/catch` and treat undefined as "renderer not ready yet" — see `updateGeom` in `Terminal.tsx`. Fit/resize is also deferred to `requestAnimationFrame` after a `ResizeObserver` fires for the same reason.

### OSC 133 is auto-injected, not opt-in

`src-tauri/src/shell_integration/scripts.rs` writes a bash/zsh integration script to `$TMPDIR/teamship-shell-integration/integration.sh` on first PTY spawn. The script is sourced via the `BASH_ENV` env var that `pty_spawn` sets on every child process — every shell session emits OSC 133 A/B/C/D sequences without user opt-in.

Frontend parses those sequences in `src/components/terminal/osc133.ts` (`registerOscHandler(133, …)`) and overlays absolute-positioned `<div>` markers on top of xterm via `CommandBlocks.tsx`. The overlay reads `terminal.buffer.active.baseY + cursorY` to anchor blocks to absolute scrollback rows — the position-syncing math in `Terminal.tsx`'s `updateGeom` is load-bearing.

### Layout is a recursive split/leaf tree

`src/lib/types.ts` defines `LayoutNode = { type: "leaf", paneId } | { type: "split", direction, sizes, children }`. The store in `src/stores/workspaceStore.ts` mutates this tree for splits and pane closes — **renormalizing `sizes` after removal** is critical or the resize handles drift. `buildLayout(paneCount, ids)` synthesizes the canonical 1/2/4/6/8/9/12/16 templates.

`PaneGrid.tsx` recursively maps the tree to nested `<PanelGroup>` from `react-resizable-panels`. The `path: number[]` argument tracks the position so resize callbacks can set sizes at the right depth via `setSizesAtPath`.

**Pane drag uses pointer events, not HTML5 drag.** WKWebView and Tauri's WebView swallow native `drop` events on iframe-bearing pages, so pane header drag-to-swap/re-split is implemented manually via `pointerdown` → `setPointerCapture` → `pointermove` → `pointerup`. Don't reach for `draggable` / `ondragstart` here.

### Panes are portaled into stable hosts

`PaneGrid.tsx` does not render `<Pane />` directly into the layout tree. Each pane gets an owned `<div class="pane-host">` that lives outside the tree; the Pane component is `createPortal`'d into that host once and the layout tree's `PaneSlot` adopts the host via `appendChild`. This is what keeps xterm/PTY state, Monaco view state, and iframe history alive across split/close/swap restructures — the React subtree never unmounts.

Implication: do not move the `createPortal` call inside the tree, do not key panes by index, and do not destroy a host when its slot remounts. The `useEffect` cleanup in `PaneGrid.tsx` that prunes hosts whose pane was deleted is the only legitimate teardown.

### Pane kinds are a closed discriminated union

Adding a new `PaneKind` requires updates in **all** of:
- `src/lib/types.ts` (the union)
- `src/components/workspace/Pane.tsx` (the switch in `PaneBody`)
- `src/components/workspace/PaneHeader.tsx` (`KIND_LABELS` and `KIND_ICONS`)

Forgetting any one leaves dead branches; TS catches the union but not the icon/label maps.

### Run Task flow

`launchAgent` in `src/lib/agentLauncher.ts` is the single entry point for spawning an agent. It is used by `KanbanBoard.runTask` and by the preview element picker's "Run now" / "Add to Kanban & run" actions. Two modes:

- `mode: "new-tab"` — creates a fresh workspace tab with one terminal pane (the original Kanban-style flow).
- `mode: "current-tab"` — calls `splitPane(tabId, paneId, direction, preset)` to add a sibling terminal pane to an existing layout. `splitPane`'s optional `preset: PanePreset` is what lets the new pane carry `pendingCommand`/`spawnEnv`/`spawnCwd`/`title` from the start.

Internal sequence in either mode:
1. `agent_launch` (Rust) writes task body + system prompt to `/tmp/teamship-tasks/task-<uuid>.md`, substitutes `{task_file}` in the agent's command template, returns `{ command, taskFile, env }`.
2. Frontend stashes `{ pendingCommand, spawnEnv, spawnCwd, title }` in the new terminal pane's payload (via `newTab` presets or `splitPane`'s preset).
3. `Terminal.tsx`'s `useEffect` sees `pendingCommand`, waits 600ms for the shell prompt to settle, then writes the command + `\n` to the PTY and clears `pendingCommand`.

The `TEAMSHIP_TASK_FILE` env var is **only** set if you wire it via the agent's stored `envJson` field — `agent_launch` returns it in `env` but the current spawn path doesn't merge that into `pty_spawn`'s env. Either substitute via `{task_file}` in the command, or extend the spawn path to pass env through.

`EPHEMERAL_KEYS` in `workspaceStore.ts` strips per-session/UI keys (`sessionId`, `pendingCommand`, `pickerActive`) from the persisted snapshot. Add to that set for any new payload key that should not survive a restart.

### Speech-to-text dispatches by active pane

Hold-to-talk (configurable hotkey, window-scoped — default `ControlRight` on Linux/Windows, `AltRight` on Mac since Apple keyboards have no Right Ctrl key; user-rebindable in Settings) records via `getUserMedia` → `MediaRecorder`, posts the audio to an OpenAI-compatible `/audio/transcriptions` endpoint through the Rust `stt_transcribe` command (uses the existing `reqwest` dep with `multipart` + `json` features), then injects text based on the snapshotted active pane:

- `terminal` → `ptyWrite` UTF-8 bytes (no `\n` — never auto-execute)
- `editor` → `monaco.executeEdits` at the current selection
- everything else → clipboard fallback + toast

Monaco instances register themselves into `src/components/stt/editorRegistry.ts` on mount because the STT injector needs cross-component access without plumbing refs through the workspace tree. If you add another text-input pane kind, extend the dispatch in `inject.ts` and not the registry.

Settings live under the `"stt"` key via `settings_get/set` — same pattern as theme. Provider/endpoint/model/key are persisted plaintext in `app_config_dir/settings.json`.

### AI chat mirrors STT

`ai_chat` (`src-tauri/src/ai/commands.rs`) powers the *Explain* action on terminal command blocks. It POSTs to a user-configured OpenAI-compatible `/chat/completions` endpoint. Settings live under the `"ai"` key. `aiStore.load()` seeds the API key from STT settings on first run, so it deliberately awaits `useSttStore.load()` if STT hasn't finished hydrating — preserve that ordering when refactoring `App.tsx`'s mount effect.

### Network proxy is centralized

Every outbound `reqwest` call goes through `src-tauri/src/net/mod.rs` — `http_client(&app)` / `http_client_builder(&app)` read the `"proxy"` settings key per call and apply HTTP/SOCKS5 proxy + `NoProxy` rules. Adding another network site means using these helpers, not `reqwest::Client::new()`.

`localhost,127.0.0.1,::1` are always added to `NoProxy` regardless of user config — `preview_detect`'s loopback probes and any local AI/STT endpoints must reach the host directly.

Out of scope for the proxy: the `<iframe>` in `PreviewPane`, the `tauri-plugin-updater` HTTP client, and shell processes spawned by PTY (those inherit the parent process env). The Settings UI says so. `reqwest`'s `socks` cargo feature is required for SOCKS5 — already enabled.

### SQLite schema gotcha

The `tasks` table column is `column_name`, not `column`. SQLite tolerates `column` as an identifier in some contexts but it's a reserved word and `tauri-plugin-sql`'s parser bails. The `Task["column"]` TS field stays `column` — `kanbanStore.ts` translates with `rowToTask`.

Migrations live in `src-tauri/migrations/*.sql` and are registered in `src-tauri/src/kanban/db.rs` via `MigrationKind::Up`. They run automatically on `Database.load("sqlite:teamship.db")`.

**Migrations are immutable once shipped.** `tauri-plugin-sql` records each migration's checksum; editing an applied SQL file makes the DB refuse to load on next launch. Always add a new numbered migration (`004_*.sql`, `005_*.sql`, …) instead of mutating an existing one.

### Theme system

A `Theme` (`src/themes/definitions.ts`) bundles three palettes: UI tokens (CSS vars), a full xterm.js `ITheme`, and via `monacoThemeFor()` a Monaco theme derived from those tokens. `applyTheme()` writes CSS custom properties to `:root` and stamps `data-theme` / `data-theme-kind`. `Terminal.tsx` and `Editor.tsx` both subscribe to `useThemeStore` and re-apply on change — themes hot-swap without restart.

Adding a theme = one entry in `definitions.ts` — purely data, no code change. The five "foundational" themes (Void, Dracula, Synthwave, Paper, Solar) are listed first; the rest follow in the same array.

### Live preview

`src/components/preview/PreviewPane.tsx` uses an `<iframe>` (not a Tauri child WebView yet). It works for localhost dev servers because they don't set `X-Frame-Options`. `preview_detect` reads `package.json` to identify the framework, then probes conventional ports — see `src-tauri/src/preview/detector.rs` for the priority lists. `preview_watch_start` spawns a `notify-debouncer-mini` (150ms) that emits `preview:reload:<paneId>` events, consumed by `useEffect` in `PreviewPane`.

### Preview element picker (cross-origin iframe injection)

The parent (Tauri scheme) and the preview iframe (`http://localhost:<port>`) are cross-origin, so `iframe.contentDocument` is unreachable. The picker bridges them with two halves:

1. **Iframe-side script** at `src-tauri/src/preview/picker_script.js` — injected into *every* frame at `document_start` via `tauri::plugin::Builder::js_init_script_on_all_frames(...)` registered as an inline plugin in `src-tauri/src/lib.rs`. This is the only iframe-script-injection mechanism in the repo; reuse the same plugin (or add another) before reaching for srcdoc/proxy hacks.
2. **Parent controller** in `PreviewPane.tsx` — toggles `pickerActive`, sends `postMessage` commands to `iframe.contentWindow`, and listens for replies filtered by `e.source === iframeRef.current?.contentWindow` to avoid cross-pane bleed.

The message envelope is `{ src: "teamship", type: "picker:start" | "picker:stop" | "picker:selected" | "picker:cancelled", payload? }` (typed in `src/lib/elementContext.ts`). Keep `src: "teamship"` on any new commands you add through this channel — the iframe script and parent listener both filter on it.

The script also re-runs on every iframe `load`, so `PreviewPane.onIframeLoad` re-sends `picker:start` when the toggle is still on after a hard reload. Element capture walks the React fiber for `_debugSource` to attach a source-file location when available.

### Frontend state

Zustand stores in `src/stores/` — `themeStore`, `workspaceStore`, `kanbanStore`, `sttStore`, `aiStore`, `proxyStore`, `screenshotStore` (plus the in-memory-only `paneDragStore`). The persisted ones are not auto-loaded — `App.tsx`'s mount effect explicitly calls each one's `load()`/`hydrate()`. Forgetting to await before reading is a common pitfall (the stores expose `loaded: boolean`). `aiStore.load()` deliberately awaits `useSttStore.load()` first to seed its API key on first run; preserve that ordering.

### App shell layout

`App.tsx`'s root is a 2×2 CSS grid (`grid-template-areas: "sidebar titlebar" / "sidebar main"`): the sidebar spans both rows on the left, the tabbar (`app-titlebar`) sits in the top-right cell, and `app-main` (workspace content + status bar) fills the bottom-right cell. There is no `app-body` wrapper — sidebar, titlebar, and main are all direct children of `app-root`. Don't reintroduce a wrapper; it breaks the grid placement.

Drag regions are marked with `data-tauri-drag-region="deep"` (currently on `app-titlebar` and `sidebar-brand`). Tauri only handles drag, not double-click maximize — `App.tsx` wires a delegated `dblclick` listener that calls `getCurrentWindow().toggleMaximize()` when the click target sits inside any drag region. Adding a new drag region inherits this for free; removing the listener breaks native title-bar feel.

On macOS (`titleBarStyle: "Overlay"`, `hiddenTitle: true`), the traffic lights overlay the top-left corner of the sidebar — `[data-platform="macos"] .sidebar-brand` adds top padding to clear them. Don't add `padding-left: 78px` to the titlebar anymore; that was for the old full-width titlebar layout.

### Terminal broadcast & Super Brain

Multi-pane selection (`tab.selectedPaneIds`) drives two cooperating flows that both write to terminal PTYs:

- `src/lib/paneBroadcast.ts` — `broadcastBytes(originPaneId, bytes)` mirrors every keystroke from the active terminal to the other selected terminals in the same tab. Single-pane sessions short-circuit early so the registered `onData` wrapper is free when broadcast is off. STT dictation also fans out through this path.
- `src/lib/superBrain.ts` — for each selected terminal, captures the latest OSC-133 command + output via `getTerminalContext()` (`terminalRegistry`), asks the AI for the next command, and writes the suggestion into the PTY **without a trailing newline**. The user reviews, then a single Enter is broadcast across all selected panes so each runs its tailored draft in parallel. Never auto-execute on the AI's behalf — the no-newline rule and the `sanitize()` stripping of fences/leading `$` exist precisely to prevent prompt-injection from running arbitrary commands.

Both rely on `terminalRegistry`'s per-pane handles. Anything that needs to read terminal context or write into a specific PTY by `paneId` should go through that registry, not by walking the DOM.

### Screenshot stack & mobile pane

`src/components/screenshot/` plus `screenshotStore` implement a clipboard-like stack of captured frames (preview iframe via `capturePreview.ts`, mobile pane via `captureMobile.ts`) that the user drags onto a terminal pane to attach as input. The drop hit-test runs in `App.tsx`'s `onDragDropEvent` — it iterates `[data-pane-id]` rects directly because `elementFromPoint` gets confused by `.pane-drop-hint` and command-block overlays. The drag itself uses native pointer events (not HTML5 drag), same reasoning as pane-header drag.

The mobile pane (`src-tauri/src/mobile/`, `src/lib/mobile.ts`) is **stage-1 skeleton** — `mobile_connect` and friends return "not implemented" until the scrcpy launcher (Android) and ScreenCaptureKit helper (iOS) land. The TS contract is locked so the React side can be wired against a stable shape; adding new mobile commands should match this skeleton-first pattern (Rust returns a typed error, TS wrapper is real).

### Team mode

Multi-agent workspaces live alongside solo workspaces. `TeamPickerTrigger` (next to `TemplatePickerTrigger` in the tab bar) collects goal + project dir + roster (role/label/AI program per agent) + skills + attachments and calls `useTeamStore.create()` → `launchTeam(teamId)` (`src/lib/teamLauncher.ts`). The launcher reuses `agent_launch` per agent, batches the resulting `PanePreset[]` into a single `newTab(N, name, presets, projectPath)` call, and persists `tab_id` + per-agent `pane_id` back to the `team_agents` table.

**Coordination is file-based.** `team_init` materializes `<projectPath>/.teamship/teams/<teamId>/` containing:

- `BOARD.md` — roster + task breakdown + status, edited by agents (especially the Coordinator)
- `MESSAGES.md` — append-only fenced markdown blocks; the canonical inter-agent log
- `.prompts/<labelSlug>.md` — per-agent role+goal+skills bundle, fed to the AI CLI as `{task_file}`
- `.rpc/` — request/response files for `tmsg pane …` calls
- `.consumed/<labelSlug>.txt` — per-agent ledger of message IDs the agent has acknowledged via `tmsg check --consume`

**`tmsg` is a shell function**, not a binary. Embedded as `src-tauri/src/team/tmsg.sh` (via `include_str!`) and written to `$TMPDIR/teamship-shell-integration/tmsg.sh` on every team launch; the existing OSC 133 integration sources it conditionally when `$TEAMSHIP_TEAM_TMSG` is set in a pane's env. Subcommands:

- `tmsg send --to <Label|@all|@operator> [--type message|status|escalation|done] --body "…"` — append a fenced block to `MESSAGES.md` (flock-protected).
- `tmsg check [--consume]` — print messages addressed to me or `@all` not yet in my `.consumed` file.
- `tmsg roster` / `tmsg board` — convenience readers.
- `tmsg pane new|close|read|write` — RPC: writes `<.rpc/uuid>.req`, polls for `.res`. **`tmsg pane new` returns "not supported yet"** — dynamic add isn't implemented; use the Team picker.

**Two watchers per team**, both in `src-tauri/src/team/watcher.rs` and stored in `TeamManager`'s `DashMap<teamId, Vec<Debouncer>>`:

- MESSAGES.md changes → emit `team:messages:<teamId>` (the chat panel re-reads + re-renders).
- New `.rpc/<uuid>.req` files → emit `team:rpc:<teamId>` (`src/lib/teamRpc.ts` dispatches to `getTerminalContext` / `closePane` / `ptyWrite`, calls `team_rpc_reply` to write the `.res` that unblocks the agent).

**The chat panel (`TeamChatPanel.tsx`)** reads `MESSAGES.md` via the existing `@tauri-apps/plugin-fs` (project paths must fall under the `fs:scope` allow-list — `$HOME/**` covers most cases). Its input box pushes drafts into PTYs via `runSuperBrainTeamBroadcast` / `runSuperBrainTeamAsk` — same no-newline contract as Super Brain (the user reviews, then presses Enter; broadcast fans Enter to selected panes).

**Restart resume**: `App.tsx`'s mount effect awaits `hydrateWorkspace()` → `loadKanban()` → `useTeamStore.load()`, then calls `resumeTeam(teamId)` for every active team whose `tab_id` matches a live tab. `resumeTeam` re-renders prompt files (so role/skill changes between releases propagate), re-derives the `pendingCommand`, and writes it back into the existing pane payloads via `setPanePayload`. The Terminal effect at `Terminal.tsx:438` re-fires when `pendingCommand` flips from undefined to a string, even if `sessionId` was already set — so re-injecting after PTY spawn still runs the agent CLI. The team-RPC subscription is also re-established here.

**`tmsg.sh` paths and team data are gitignorable.** Add `.teamship/` to the project's `.gitignore` if you don't want coordination logs in PRs. The directory is intentionally inside the working tree so agents can read it with their normal file tools.

### Build artifacts

`src-tauri/gen/` (gitignored) is regenerated by Tauri from `tauri.conf.json` on every build — do not edit. `src-tauri/icons/` are placeholder purple PNGs; replace before any release bundle.
