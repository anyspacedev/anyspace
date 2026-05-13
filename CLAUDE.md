# CLAUDE.md

These rules apply to every task in this project unless explicitly overridden.
Bias: caution over speed on non-trivial work. Use judgment on trivial tasks.

## Rule 1 — Think Before Coding
State assumptions explicitly. If uncertain, ask rather than guess.
Present multiple interpretations when ambiguity exists.
Push back when a simpler approach exists.
Stop when confused. Name what's unclear.

## Rule 2 — Simplicity First
Minimum code that solves the problem. Nothing speculative.
No features beyond what was asked. No abstractions for single-use code.
Test: would a senior engineer say this is overcomplicated? If yes, simplify.

## Rule 3 — Surgical Changes
Touch only what you must. Clean up only your own mess.
Don't "improve" adjacent code, comments, or formatting.
Don't refactor what isn't broken. Match existing style.

## Rule 4 — Goal-Driven Execution
Define success criteria. Loop until verified.
Don't follow steps. Define success and iterate.
Strong success criteria let you loop independently.

## Rule 5 — Use the model only for judgment calls
Use me for: classification, drafting, summarization, extraction.
Do NOT use me for: routing, retries, deterministic transforms.
If code can answer, code answers.

## Rule 6 — Token budgets are not advisory
Per-task: 4,000 tokens. Per-session: 30,000 tokens.
If approaching budget, summarize and start fresh.
Surface the breach. Do not silently overrun.

## Rule 7 — Surface conflicts, don't average them
If two patterns contradict, pick one (more recent / more tested).
Explain why. Flag the other for cleanup.
Don't blend conflicting patterns.

## Rule 8 — Read before you write
Before adding code, read exports, immediate callers, shared utilities.
"Looks orthogonal" is dangerous. If unsure why code is structured a way, ask.

## Rule 9 — Tests verify intent, not just behavior
Tests must encode WHY behavior matters, not just WHAT it does.
A test that can't fail when business logic changes is wrong.

## Rule 10 — Checkpoint after every significant step
Summarize what was done, what's verified, what's left.
Don't continue from a state you can't describe back.
If you lose track, stop and restate.

## Rule 11 — Match the codebase's conventions, even if you disagree
Conformance > taste inside the codebase.
If you genuinely think a convention is harmful, surface it. Don't fork silently.

## Rule 12 — Fail loud
"Completed" is wrong if anything was skipped silently.
"Tests pass" is wrong if any were skipped.
Default to surfacing uncertainty, not hiding it.


## Commands

```bash
npm install                  # JS deps (Cargo handles its own)
npm run tauri:dev            # Vite :1420 + cargo run, hot reload
npm run tauri:build          # bundle .deb / .AppImage / .dmg / .msi
npx tsc --noEmit             # frontend typecheck (CI gate)
cd src-tauri && cargo check  # Rust typecheck
```

**Floor:** Tauri 2 needs `glib-2.0 >= 2.70` (Debian 12+ / Ubuntu 22.04+), Rust ≥ 1.77, Node ≥ 20. `tauri::generate_context!()` reads `src-tauri/icons/*` at compile time — must exist or `cargo check` panics.

## Architecture

Tauri v2 desktop app (Rust + React 19/Vite) implementing a multi-pane terminal multiplexer with Warp-style command blocks, Monaco editor, v0.dev-style live preview, and a Kanban-driven AI agent launcher.

### IPC contract

Every Rust command in `src-tauri/src/*/commands.rs` has a typed wrapper in `src/lib/tauri.ts`. Adding one requires:
1. `#[tauri::command]` fn
2. Register in `tauri::generate_handler![...]` (`src-tauri/src/lib.rs`)
3. `tauri.ts` wrapper (plus `capabilities/default.json` *only* for plugin commands — project commands are covered by `core:default`)

Skip any and the command silently fails at runtime. Commands needing settings/proxy-aware HTTP/events should take `app: tauri::AppHandle` as the first parameter (Tauri injects it).

### PTY streaming uses Channels, not events

`tauri::ipc::Channel<Vec<u8>>` carries terminal output. `pty_spawn` accepts a frontend-allocated `Channel`; Rust pumps `portable_pty::Reader` → 4KB chunks → `channel.send` on a `std::thread`. Don't switch to `app.emit()` for PTY data. **Do not** introduce a Node sidecar — `portable-pty` is pure Rust and uses ConPTY on Windows automatically.

**xterm WebGL cap = 6.** Browsers evict the oldest context past their limit (Chromium ~16, WebKit ~8), spamming console errors. `Terminal.tsx` tracks `activeWebglTerminals` and falls back to the DOM renderer past `MAX_WEBGL_TERMINALS = 6`. Don't raise without testing eviction on Linux/Chromium.

**Renderer dimensions race.** `terminal._core._renderService.dimensions` crashes if read before first paint. Any reader (block-overlay geom, fit-addon math) must `try/catch` and treat undefined as "not ready" — see `updateGeom` in `Terminal.tsx`. Fit/resize is deferred to `requestAnimationFrame` after `ResizeObserver`.

### OSC 133 is auto-injected

`src-tauri/src/shell_integration/scripts.rs` writes a bash/zsh script to `$TMPDIR/anyspace-shell-integration/integration.sh` on first PTY spawn, sourced via `BASH_ENV` — every shell emits OSC 133 A/B/C/D. Frontend parses in `src/components/terminal/osc133.ts`; `CommandBlocks.tsx` overlays absolute-positioned markers anchored to `terminal.buffer.active.baseY + cursorY`. The position-syncing math in `Terminal.tsx`'s `updateGeom` is load-bearing.

### Layout = recursive split/leaf tree

`LayoutNode = { type:"leaf", paneId } | { type:"split", direction, sizes, children }` in `src/lib/types.ts`. `workspaceStore.ts` mutates the tree — **renormalize `sizes` after removal** or resize handles drift. `buildLayout(paneCount, ids)` synthesizes canonical 1/2/4/6/8/9/12/16 templates. `PaneGrid.tsx` recursively maps to `<PanelGroup>`; the `path: number[]` arg routes resize callbacks via `setSizesAtPath`.

**Pane drag uses pointer events, not HTML5 drag.** WKWebView/Tauri WebView swallow native `drop` on iframe pages — use `pointerdown` → `setPointerCapture` → `pointermove` → `pointerup`. Same for screenshot drag-onto-pane.

### Panes are portaled into stable hosts

`PaneGrid.tsx` does NOT render `<Pane />` into the layout tree. Each pane has an owned `<div class="pane-host">` outside the tree; `createPortal`'d once, layout's `PaneSlot` adopts via `appendChild`. This keeps xterm/PTY/Monaco/iframe state alive across split/close/swap restructures. Do not move `createPortal` into the tree, do not key by index, do not destroy hosts on slot remount. The `useEffect` cleanup in `PaneGrid.tsx` is the only legitimate teardown.

### Pane kinds are a closed discriminated union

Adding a `PaneKind` requires updates in **all** of: `src/lib/types.ts` (union), `Pane.tsx` (`PaneBody` switch), `PaneHeader.tsx` (`KIND_LABELS` + `KIND_ICONS`). TS catches the union but not the icon/label maps.

### Run Task flow

`launchAgent` (`src/lib/agentLauncher.ts`) is the single agent-spawn entry point. Two modes: `"new-tab"` (fresh tab with one terminal) or `"current-tab"` (calls `splitPane(tabId, paneId, direction, preset)`). Sequence:

1. `agent_launch` writes task+system prompt to `/tmp/anyspace-tasks/task-<uuid>.md`, substitutes `{task_file}`, returns `{ command, taskFile, env }`.
2. Frontend stashes `{ pendingCommand, spawnEnv, spawnCwd, title }` in the pane payload.
3. `Terminal.tsx` sees `pendingCommand`, waits 600ms for shell prompt, writes command + `\n`, clears it.

`ANYSPACE_TASK_FILE` is only set if wired via the agent's `envJson` — the current spawn path doesn't merge `agent_launch`'s returned `env` into `pty_spawn`. Substitute via `{task_file}` in the command, or extend the spawn path.

`EPHEMERAL_KEYS` in `workspaceStore.ts` strips per-session/UI keys (`sessionId`, `pendingCommand`, `pickerActive`) from the persisted snapshot. Add new payload keys that shouldn't survive restart.

### Speech-to-text

Hold-to-talk (default `ControlRight` Linux/Windows, `AltRight` macOS — Apple keyboards have no Right Ctrl; rebindable in Settings) records via `getUserMedia` → `MediaRecorder`, POSTs to OpenAI-compatible `/audio/transcriptions` via Rust `stt_transcribe` (uses existing `reqwest` with `multipart`+`json`). Dispatch on snapshotted active pane:

- terminal → `ptyWrite` UTF-8 bytes (no `\n` — never auto-execute)
- editor → `monaco.executeEdits` at current selection
- else → clipboard + toast

Monaco instances register into `src/components/stt/editorRegistry.ts` on mount. New text-input pane kinds: extend dispatch in `inject.ts`, not the registry. Settings under `"stt"` key (plaintext in `app_config_dir/settings.json`).

### AI chat

`ai_chat` (`src-tauri/src/ai/commands.rs`) powers terminal-block *Explain*. POSTs to OpenAI-compatible `/chat/completions`. Settings under `"ai"` key. `aiStore.load()` seeds API key from STT on first run, so it deliberately awaits `useSttStore.load()` — preserve that ordering in `App.tsx`'s mount effect.

### Network proxy is centralized

All outbound `reqwest` calls go through `src-tauri/src/net/mod.rs` — `http_client(&app)` / `http_client_builder(&app)` read the `"proxy"` key per call, apply HTTP/SOCKS5 + `NoProxy`. Use these, not `reqwest::Client::new()`. `localhost,127.0.0.1,::1` always in `NoProxy`. Out of scope: PreviewPane `<iframe>`, `tauri-plugin-updater`, PTY-spawned shells. SOCKS5 needs `reqwest`'s `socks` feature (enabled).

### SQLite

`tasks` column is `column_name`, not `column` (reserved word; `tauri-plugin-sql`'s parser bails). TS field stays `column` — `kanbanStore.ts:rowToTask` translates. Migrations in `src-tauri/migrations/*.sql` registered via `MigrationKind::Up` in `kanban/db.rs`, run on `Database.load("sqlite:anyspace.db")`.

**Migrations are immutable once shipped.** `tauri-plugin-sql` records checksums; editing an applied SQL file breaks DB load. Always add a new numbered file.

### Theme system

A `Theme` (`src/themes/definitions.ts`) bundles UI tokens (CSS vars), xterm.js `ITheme`, and `monacoThemeFor()` derives Monaco. `applyTheme()` writes CSS custom properties to `:root` and stamps `data-theme`/`data-theme-kind`. `Terminal.tsx` and `Editor.tsx` subscribe to `useThemeStore` — hot-swap without restart. Adding a theme = one entry in `definitions.ts`. Foundational five (Void, Dracula, Synthwave, Paper, Solar) listed first.

### Live preview

`PreviewPane.tsx` uses an `<iframe>`. Works for localhost dev servers (no `X-Frame-Options`). `preview_detect` reads `package.json`, probes conventional ports per `src-tauri/src/preview/detector.rs`. `preview_watch_start` spawns `notify-debouncer-mini` (150ms) emitting `preview:reload:<paneId>`.

### Preview element picker (cross-origin)

Parent (Tauri scheme) and iframe (`http://localhost:<port>`) are cross-origin; `iframe.contentDocument` is unreachable. Two halves:

1. **Iframe-side**: `src-tauri/src/preview/picker_script.js` injected at `document_start` into every frame via `tauri::plugin::Builder::js_init_script_on_all_frames(...)` (inline plugin in `lib.rs`). Only iframe-injection mechanism in the repo — reuse before reaching for srcdoc/proxy hacks.
2. **Parent**: `PreviewPane.tsx` toggles `pickerActive`, `postMessage`s commands, filters replies by `e.source === iframeRef.current?.contentWindow`.

Envelope `{ src: "anyspace", type: "picker:start"|"picker:stop"|"picker:selected"|"picker:cancelled", payload? }` (typed in `src/lib/elementContext.ts`). Keep `src: "anyspace"` on any new commands. Script re-runs on iframe `load`; `PreviewPane.onIframeLoad` re-sends `picker:start` if toggle still on. Capture walks React fiber for `_debugSource`.

### Frontend state

Zustand stores in `src/stores/` — `themeStore`, `workspaceStore`, `kanbanStore`, `sttStore`, `aiStore`, `proxyStore`, `screenshotStore` (+ in-memory `paneDragStore`). Persisted stores aren't auto-loaded — `App.tsx`'s mount effect calls each `load()`/`hydrate()`. They expose `loaded: boolean`. `aiStore.load()` awaits `useSttStore.load()` first (seeds API key) — preserve ordering.

### App shell layout

`App.tsx` root is a 2×2 CSS grid (`"sidebar titlebar" / "sidebar main"`). Sidebar spans both rows; tabbar (`app-titlebar`) top-right; `app-main` (workspace + status bar) bottom-right. No `app-body` wrapper — don't reintroduce it.

Drag regions: `data-tauri-drag-region` on the immediate event target only (Tauri 2.10's `drag.js` doesn't honor `"deep"`). Lives on `.app-titlebar`, `.sidebar-brand`, inner containers (`.tabbar`, `.tabbar-title`, `.tabbar-actions`, `.tabbar-tabs-spacer`), and `.sidebar-brand` children. Interactive children (`.tab`, `.tab-close`, `.workspace-folder-pill`, new-workspace button, `.nav-item`) stay attribute-free. **`.tabbar-tabs` must NOT carry it** — overflow scrollbar's mousedown lands there and gets hijacked. The `.tabbar-tabs-spacer` sibling (`flex:1 1 auto`, collapses on overflow) carries the attribute instead. Tauri 2.10 handles double-click maximize natively — no JS dblclick needed. Any new title-bar element needs `data-tauri-drag-region=""` or it's a dead zone on macOS.

macOS (`titleBarStyle:"Overlay"`, `hiddenTitle:true`): traffic lights overlay sidebar top-left — `[data-platform="macos"] .sidebar-brand` adds top padding. Don't re-add `padding-left:78px` to the titlebar (that was the old full-width layout).

### Terminal broadcast & Super Brain

`tab.selectedPaneIds` drives two PTY-writer flows:

- `paneBroadcast.ts:broadcastBytes(originPaneId, bytes)` mirrors keystrokes from active terminal to other selected terminals in the same tab. Single-pane sessions short-circuit. STT dictation also fans out here.
- `superBrain.ts` per-selected-terminal: captures latest OSC-133 command+output via `getTerminalContext()` (`terminalRegistry`), asks AI for next command, writes draft into PTY **without `\n`**. User reviews; one Enter is broadcast across all selected panes. Never auto-execute — no-newline rule and `sanitize()` (strips fences/leading `$`) prevent prompt-injection.

Both go through `terminalRegistry`'s per-pane handles. Read context / write to PTY by `paneId` via the registry, not the DOM.

### Screenshot stack & mobile pane

`src/components/screenshot/` + `screenshotStore` = clipboard-like stack of captured frames (preview iframe via `capturePreview.ts`, mobile via `captureMobile.ts`) draggable onto a terminal as input. Drop hit-test runs in `App.tsx:onDragDropEvent` and iterates `[data-pane-id]` rects directly (`elementFromPoint` is confused by `.pane-drop-hint` and command-block overlays). Native pointer events (same as pane-header drag).

Mobile pane (`src-tauri/src/mobile/`, `src/lib/mobile.ts`) is **stage-1 skeleton** — `mobile_connect` etc. return "not implemented" until scrcpy launcher (Android) and ScreenCaptureKit helper (iOS) land. TS contract is locked. Follow skeleton-first pattern when adding mobile commands.

### Team mode

Multi-agent workspaces. `TeamPickerTrigger` collects goal + project dir + roster (role/label/AI program per agent) + skills + attachments and calls `useTeamStore.create()` → `launchTeam(teamId)` (`src/lib/teamLauncher.ts`). Launcher reuses `agent_launch` per agent, batches `PanePreset[]` into a single `newTab(N, name, presets, projectPath)`, persists `tab_id` + per-agent `pane_id` in `team_agents`.

**Coordination is file-based.** `team_init` materializes `<projectPath>/.anyspace/teams/<teamId>/`:
- `BOARD.md` — roster + tasks + status (agent-edited, esp. Coordinator)
- `MESSAGES.md` — append-only fenced blocks; inter-agent log
- `.prompts/<labelSlug>.md` — per-agent role+goal+skills bundle, fed as `{task_file}`
- `.rpc/` — req/res files for `tmsg pane …`
- `.consumed/<labelSlug>.txt` — per-agent ack ledger for `tmsg check --consume`

**`tmsg` is a shell function**, not a binary. Embedded as `src-tauri/src/team/tmsg.sh` (via `include_str!`), written to `$TMPDIR/anyspace-shell-integration/tmsg.sh` per team launch. OSC 133 integration sources it conditionally when `$ANYSPACE_TEAM_TMSG` is set. Subcommands: `send`, `check [--consume]`, `roster`, `board`, `pane new|close|read|write` (RPC: writes `<.rpc/uuid>.req`, polls for `.res`; `pane new` splits the requester's pane via `teamRpc.ts:handleNew`).

**Two watchers per team** in `src-tauri/src/team/watcher.rs`, stored in `TeamManager`'s `DashMap<teamId, Vec<Debouncer>>`:
- MESSAGES.md changes → `team:messages:<teamId>`. Only subscriber is `src/lib/operatorInbox.ts` (the legacy `TeamChatPanel.tsx` was deleted; `read_team_messages` Super Agent tool reads on demand).
- New `.rpc/<uuid>.req` → `team:rpc:<teamId>` (`teamRpc.ts` dispatches to `getTerminalContext`/`closePane`/`ptyWrite`, calls `team_rpc_reply` to unblock).

**Operator inbox.** `operatorInbox.ts` listens per-team, re-reads MESSAGES.md via `parseMessages`, filters `to=@operator || type=escalation`, dedupes against `lastSeenTs[teamId]`, pushes to `useOperatorInboxStore`. `App.tsx`'s mount effect calls `syncOperatorInboxSubscriptions()` after `resumeTeam`; a `useTeamStore.subscribe` re-runs the sync on launch/archive (idempotent). Status-bar `● N @operator` pill clicks → `handoffInboxToSuperAgent` (`src/lib/operatorInboxHandoff.ts`) opens the SA rail, ensures session, appends one `role:"system"` summary, clears the inbox. Initial drain surfaces escalations from when the app was closed; empty MESSAGES.md seeds `lastSeenTs` to newest existing ts so history doesn't replay.

**Operator → team panes** (both no-newline by default — operator presses Enter to actually run):
- *Direct*: multi-select panes and type; `paneBroadcast.ts` fans keystrokes.
- *Conversational*: Super Agent's `team_broadcast(team_id, text, with_newline?)` and `team_send_to_pane(team_id, text, pane_id?|label?, with_newline?)`. Targeted writes resolve `label` against `useTeamStore.agents[teamId]`.

**Restart resume**: mount effect awaits `hydrateWorkspace()` → `loadKanban()` → `useTeamStore.load()`, then `resumeTeam(teamId)` for active teams whose `tab_id` matches a live tab. `resumeTeam` re-renders prompts, re-derives `pendingCommand`, writes back via `setPanePayload`. `Terminal.tsx:438` re-fires when `pendingCommand` flips undefined→string, even with `sessionId` already set. Team-RPC subscription re-established.

`.anyspace/` is in `.gitignore` but lives in the working tree so agents read it normally.

**Auto-archive on tab close.** `App.tsx` subscribes to `useWorkspaceStore`, calls `useTeamStore.archive(teamId)` when team's `tabId` leaves `tabs`. Stops watchers, marks `teams.status='archived'`. Team files stay on disk; reactivation from Teams view re-launches.

**Teams view** (`src/components/team/TeamsView.tsx`) is a sidebar nav between Kanban and Agents. Per-row: Open / Launch / Reactivate / Rename / Archive. `reactivate(teamId)` clears stale `tab_id` and per-agent `pane_id` before relaunch.

**`settings.team`** (via `useTeamSettingsStore`, JSON in `settings_get/set("team")`):
```ts
{ customSkills: {id,label,body}[], customRoles: {id,label,accent?,body}[], templates: {id,name,goalSeed?,roster,skillIds}[] }
```
Old keys (`chatPanelWidth`/`chatPanelMode`) ignored silently. No migration needed. Custom role ids prefixed with `custom:` (no collision with `BUILTIN_ROLES`). Use `roleLabel/Accent/PromptBody(role, customRoles)` for either; legacy `ROLE_LABELS`/`ROLE_ACCENTS` still work for built-in-only. New built-in role still requires editing `teamRoles.ts` (BUILTIN_ROLES, BUILTIN_LABELS, BUILTIN_ACCENTS, BUILTIN_BODIES — body map is the easy miss).

**Templates** snapshot `{name, goalSeed, roster, skillIds}`. Roster rows store `agentId` hint; if the kanban agent was deleted, apply falls back to first available. Save is a button next to Cancel.

**AI-assisted decomposition** (`src/lib/teamDecompose.ts`) calls `aiChat` with strict-JSON system prompt + catalog of built-in roles/programs/skills. Output `{teamName, roster:[{role,label,programHint}], skillIds, notes?}`. Tolerates stray sentences and ```json fences. Picker button fills form; missing `programHint` falls back to first kanban agent.

**MESSAGES.md compaction.** `team_compact_messages` (`src-tauri/src/team/commands.rs`) holds the same `flock(.lock)` `tmsg.sh` uses, splits at block boundaries, appends oldest to `MESSAGES.archive.md`, atomically replaces MESSAGES.md. Default 500/keep 250. Triggered from `operatorInbox.ts:maybeCompact` (debounced 60s/team). **Unix-only** (Windows = no-op stub); team mode still works on Windows because `tmsg.sh`'s `/usr/bin/flock` holds the lock inside WSL.

**Voice-to-team.** STT `inject.ts:fanToTeamPanes(originPaneId, originSessionId, bytes)` runs after the normal terminal write. If source pane is in a team tab and `tab.selectedPaneIds.length < 2`, dictation fans to other team-pane PTYs (no newline). Explicit multi-select uses `broadcastBytes`; `fanToTeamPanes` short-circuits to avoid double-writes.

**Resume logging.** Grep `[team.resume] start/skip/done` (`teamLauncher.ts`) and `[terminal] pendingCommand armed/firing` (`Terminal.tsx`) to verify restart resume.

### Super Agent

Multi-turn AI chat **inside the app** with tools for inspecting/manipulating the workspace. Distinct from Team mode (external CLIs in PTYs) and Super Brain v1 (one-shot ⌘⇧B — preserved).

**Surfaces:**
- **Side rail** (`SuperAgentPanel mode="rail"`, in `WorkspaceView` when `useSuperAgentStore.panelOpen`). Workspace grid becomes `1fr + var(--super-agent-w)`. Pointer-drag resize on left edge persists `settings.superAgent.panelWidth` (clamped 240–720).
- **Full-page** at `selectedView === "superagent"` (sidebar nav between Teams and Agents; `mode="full"`).
- **Collapsed pill** (`.sa-collapsed-tab`) in `.workspace-content` when closed.

**Runtime** — `@earendil-works/pi-agent-core` `Agent` class lives in the webview; we no longer maintain our own ReAct loop. `src/lib/superAgent/agent.ts:createSuperAgent` builds the Agent from settings + `resolveAiCreds`; `piRunner.ts:runPiPrompt` is the headless entry point; `panelBridge.ts` translates pi `AgentEvent`s into legacy Zustand-store mutations so the existing `SuperAgentPanel.tsx` / `MessageBubble.tsx` / `ToolCallCard.tsx` keep rendering unchanged. `runner.ts` is a 30-line shim re-exporting `sendUserMessage`, `abortActive`, `decideQueuedToolCall` for back-compat with existing imports.

**Data model:**
- Sessions live in `super_agent_sessions` (migration `005_super_agent.sql`).
- Messages live in `super_agent_messages_v2` (migration `007_super_agent_pi.sql`) — one JSON blob per row matching pi's `AgentMessage` union (`UserMessage | AssistantMessage | ToolResultMessage` with `TextContent / ImageContent / ThinkingContent / ToolCall` blocks). `persistence.ts:loadAgentMessages` migrates from the legacy `super_agent_messages` table (kept around for safety) lazily on first session open and stamps `super_agent_sessions.pi_version` to prevent re-running.

**Provider transport — direct from webview.** `pi-ai`'s openai-completions provider calls the user's endpoint via the `openai` SDK with `dangerouslyAllowBrowser: true` + `baseURL: model.baseUrl`. AnySpace Cloud preset mints a Clerk JWT through `resolveAiCreds`; BYO presets pass through the stored key. Consequence: **AI traffic skips `src-tauri/src/net/mod.rs`'s reqwest proxy** — Chromium picks up the OS proxy instead. The Rust SSE bridge (`ai_chat_stream` / `abort_ai_chat_stream` / `AiStreamManager`) was retired in phase 6 of the pi refactor; only the one-shot `ai_chat` Rust command survives, called exclusively by `settings/probe.ts`'s "Test AI Connection" button.

**Event → store translation (`panelBridge.ts`):** `message_start[role=assistant]` → `appendMessage(streaming:true)`; `message_update.text_delta` → setState content; `message_update.thinking_delta` → setState reasoningContent; `message_update.toolcall_end` → capture `ToolCall` in `liveToolCalls`; `message_end` → finalize via `updateMessage(toolCalls, streaming:false)`; `tool_execution_start` → `appendMessage(role:"tool", toolResults:[{status:"running"}])`; `tool_execution_end` → `updateMessage(toolResults:[{status: ok|error, resultText, images?}])` with `images` pulled from `result.details.imagePaths` (set by the adapter). **Subscriber promises gate run settlement** — pi awaits each `subscribe` callback's return; the bridge MUST return a `Promise` so `setState` mutations serialize (fire-and-forget `void handleEvent(...)` was a load-bearing bug in early 4b).

**Tool adapter (`tools/index.ts`):** pi-ai's `validateToolArguments` accepts raw JSON-Schema when no TypeBox metadata is present (`utils/validation.js:257`), so the existing `TOOLS: Tool[]` registry in `tools.ts` (1659 lines, 41 tools) passes through unchanged. `adaptTool(legacy)` wraps each entry into `AgentTool<TSchema, PiToolDetails>` — handler stays in `tools.ts`, only the surface gets pi-shaped. `filterEnabledTools(toolEnabledMap)` honors the per-tool disable map. New tools default-enabled — `toolEnabled[name] !== false` is the gate.

**Trust mode + pause/queue.** Write tools execute immediately (audit surface = inline `ToolCallCard`). Pause toggle flips `useSuperAgentStore.pauseToolCalls`; on the next tool call, pi's `beforeToolCall` (built by `panelBridge:buildBeforeToolCall`) flips the existing tool row to `status:"queued"` and `await`s a `decideQueuedToolCall` decision. **Pi event-order gotcha:** `tool_execution_start` fires BEFORE `beforeToolCall` (agent-loop.js:246-251 sequential, :279-283 parallel). Row creation lives in `tool_execution_start`; `beforeToolCall` only mutates the existing row's status. Skipping that order produces duplicate "tool" rows.

**⌘⇧B and AI Explain** (`src/lib/superBrain.ts`, `src/lib/aiSuggest/runner.ts`) route through `piAiChat` (`src/lib/aiSuggest/piAiChat.ts`) — a one-shot wrapper over pi-ai's `completeSimple`. No Agent, no tools, no loop. Same `{endpoint, apiKey, model, systemPrompt, userMessage} → Promise<string>` signature as the legacy `aiChat`. `settings/probe.ts` is the sole remaining caller of the Rust `ai_chat` command.

**Voice-in.** Super Agent textarea registers in `inputRegistry.ts` (mirrors `editorRegistry`). STT's last-resort fallback (`inject.ts`) — after focused-input / focused-pane checks fail — checks `useSuperAgentStore.panelOpen || selectedView === "superagent"` and writes via `setRangeText` + dispatched input events.

**Settings** persisted under `"superAgent"` via `useSuperAgentSettingsStore`. Endpoint/key/model are *optional overrides* — empty strings fall back to AI section. Per-tool toggles default enabled.

**Native Anthropic** is now first-class via pi-ai's `anthropic-messages` api — the legacy OpenAI-compat-proxy caveat no longer applies. We currently always build an `openai-completions` Model in `agent.ts` regardless of provider, so AnySpace Cloud + every BYO preset routes through OpenAI-compat shape. A future change can branch on `aiStore.presetId` to construct a native `anthropic-messages` Model when the user has an Anthropic key.

### Windows

Supported but constrained — `cmd.exe`/PowerShell can't source the bash/zsh OSC 133 hook that Super Brain, command blocks, and `tmsg.sh` depend on, so terminals run **inside WSL**.

`pick_shell()` (`src-tauri/src/pty/session.rs`) probes `C:\Windows\System32\wsl.exe`. Present → `wsl.exe -e bash -il`. Missing → `Err(anyhow!("WSL_NOT_INSTALLED"))`, forwarded to frontend; `Terminal.tsx` pattern-matches and renders the WSL-required overlay (link to install docs) instead of a degraded shell.

Two namespace crossings:
- **`--rcfile` arg**: bash wrapper rc lives at Windows-native temp path; `shell_integration::scripts::to_wsl_path()` rewrites to `/mnt/c/…` under `#[cfg(windows)]`.
- **`WSLENV`**: env vars don't reach Linux processes by default. Windows branch of `PtySession::spawn` builds `WSLENV` with `/p` for path-typed keys (`ANYSPACE_SHELL_INTEGRATION`, `BASH_ENV`, `ANYSPACE_TEAM_BIN_DIR`, `ANYSPACE_TEAM_TMSG`, `ANYSPACE_TASK_FILE`) and verbatim for ID/URL/string keys (`ANYSPACE_PANE_ID`, `ANYSPACE_TAB_ID`, `ANYSPACE_API_URL`, `ANYSPACE_API_TOKEN`, `TERM`, `COLORTERM`). Existing `WSLENV` preserved by prepend.

If WSL distro has `automount` disabled in `/etc/wsl.conf`, `/mnt/c/…` doesn't exist and the bash wrapper rc can't source — OSC 133 no-ops silently. Fix: `automount = true` + `wsl --shutdown`.

Other gates:
- **iOS preview hidden on non-macOS** (`DeviceChooser.tsx` checks `isMacPlatform()`; Rust `simctl.rs`/`ios_simulator.rs` stub on non-macOS; stale `target:"ios"` payload coerced to `"android"` in the chooser's `useState` initializer).
- **Android pane works on Windows** with `adb.exe` + `scrcpy(.exe)` on PATH (`mobile/adb.rs` prefers `.exe` under `cfg!(windows)`).
- **Team mode** runs in WSL so `tmsg.sh` (bash, `flock`, `uuidgen`) works as-is. MESSAGES.md compaction (`#[cfg(unix)] libc::flock`) is no-op on Windows; team mode still works because `/usr/bin/flock` holds the lock inside WSL.
- **`enable_media_capture`** (WKPreferences private SPI in `lib.rs`) is macOS-only; WebView2 grants media permissions differently — STT works on Windows without it.
- **STT hotkey default**: `ControlRight` Windows/Linux, `AltRight` macOS — `sttStore.defaultHotkey()` platform-switches.

Supporting `cmd.exe`/PowerShell as fallback is a non-goal: terminal-output-dependent features assume bash-in-WSL with OSC 133 + `tmsg` plumbing.

### Build artifacts

`src-tauri/gen/` (gitignored) is regenerated by Tauri from `tauri.conf.json` every build — do not edit. `src-tauri/icons/` are placeholder purple PNGs; replace before release.
