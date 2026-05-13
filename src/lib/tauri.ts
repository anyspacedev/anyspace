import { invoke as rawInvoke, Channel } from "@tauri-apps/api/core";

// Typed wrappers for our Rust commands.

export type SessionId = string;

export type SpawnProgram = {
  cmd: string;
  args: string[];
};

export type SpawnArgs = {
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
  paneId?: string;
  tabId?: string;
  /** Override the PTY root process. When set, the PTY spawns this binary
   *  directly (e.g. `ssh user@host`) instead of the user's interactive
   *  shell. On Windows the program is wrapped with `wsl.exe -e` so the
   *  Linux binary inside the WSL distro is reachable. */
  program?: SpawnProgram;
};

export async function ptySpawn(
  args: SpawnArgs,
  onData: Channel<Uint8Array>,
): Promise<SessionId> {
  return rawInvoke<SessionId>("pty_spawn", { args, onData });
}

export async function ptyWrite(sessionId: SessionId, data: Uint8Array): Promise<void> {
  return rawInvoke("pty_write", { sessionId, data: Array.from(data) });
}

export async function ptyResize(
  sessionId: SessionId,
  cols: number,
  rows: number,
): Promise<void> {
  return rawInvoke("pty_resize", { sessionId, cols, rows });
}

export async function ptyKill(sessionId: SessionId): Promise<void> {
  return rawInvoke("pty_kill", { sessionId });
}

export type DetectedPreview = {
  url: string;
  port: number;
  framework: string;
  verified: boolean;
};

export async function previewDetect(
  projectPath: string,
): Promise<DetectedPreview | null> {
  return rawInvoke<DetectedPreview | null>("preview_detect", { projectPath });
}

export type FrameabilityReason =
  | "ok"
  | "x-frame-options"
  | "csp-frame-ancestors"
  | "unreachable"
  | "non-2xx";

export type FrameabilityReport = {
  reachable: boolean;
  framable: boolean;
  reason: FrameabilityReason;
  status: number | null;
};

export async function previewCanFrame(url: string): Promise<FrameabilityReport> {
  return rawInvoke<FrameabilityReport>("preview_can_frame", { url });
}

export type PreviewReloadKind = "soft" | "hard";

export type PreviewReloadEvent = {
  kind: PreviewReloadKind;
  path: string;
};

export async function previewWatchStart(
  paneId: string,
  projectPath: string,
): Promise<void> {
  return rawInvoke("preview_watch_start", { paneId, projectPath });
}

export async function previewWatchStop(paneId: string): Promise<void> {
  return rawInvoke("preview_watch_stop", { paneId });
}

// === Browser pane (embedded child WebView) ===
// Each browser pane owns one child WebView keyed by `paneId`. The frontend
// drives placement (browserResize is called by a ResizeObserver on the pane
// host) and visibility (browserHide/Show toggled by the modal-occlusion
// coordinator). Cookies/storage are isolated per pane via data_directory.

export async function browserCreate(paneId: string, url: string): Promise<void> {
  return rawInvoke("browser_create", { paneId, url });
}

export async function browserNavigate(paneId: string, url: string): Promise<void> {
  return rawInvoke("browser_navigate", { paneId, url });
}

export async function browserBack(paneId: string): Promise<void> {
  return rawInvoke("browser_back", { paneId });
}

export async function browserForward(paneId: string): Promise<void> {
  return rawInvoke("browser_forward", { paneId });
}

export async function browserReload(paneId: string): Promise<void> {
  return rawInvoke("browser_reload", { paneId });
}

export async function browserResize(args: {
  paneId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}): Promise<void> {
  return rawInvoke("browser_resize", args);
}

export async function browserShow(paneId: string): Promise<void> {
  return rawInvoke("browser_show", { paneId });
}

export async function browserHide(paneId: string): Promise<void> {
  return rawInvoke("browser_hide", { paneId });
}

export async function browserDestroy(paneId: string): Promise<void> {
  return rawInvoke("browser_destroy", { paneId });
}

export type LaunchArgs = {
  agentCommand: string;
  taskId?: string;
  taskTitle: string;
  taskBody: string;
  taskColumn?: string;
  systemPrompt?: string;
  envJson?: string;
};

export type LaunchPlan = {
  command: string;
  taskFile: string;
  env: Record<string, string>;
};

export async function agentLaunch(args: LaunchArgs): Promise<LaunchPlan> {
  return rawInvoke<LaunchPlan>("agent_launch", { args });
}

export type FileEntry = {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
};

export async function fsListDirRecursive(
  path: string,
  maxDepth = 4,
): Promise<FileEntry[]> {
  return rawInvoke<FileEntry[]>("fs_list_dir_recursive", { path, maxDepth });
}

export type GitStatusLetter = "M" | "A" | "D" | "R" | "C" | "?" | "U";

export async function gitStatus(dir: string): Promise<Record<string, GitStatusLetter>> {
  return rawInvoke<Record<string, GitStatusLetter>>("git_status", {
    args: { dir },
  });
}

export async function settingsGet<T = unknown>(key: string): Promise<T | null> {
  return rawInvoke<T | null>("settings_get", { key });
}

export async function settingsSet(key: string, value: unknown): Promise<void> {
  return rawInvoke("settings_set", { key, value });
}

export type SttTranscribeArgs = {
  endpoint: string;
  apiKey: string;
  model: string;
  audio: Uint8Array;
  mime?: string;
  filename?: string;
  language?: string;
  provider?: "openai" | "elevenlabs";
};

export async function sttTranscribe(args: SttTranscribeArgs): Promise<string> {
  return rawInvoke<string>("stt_transcribe", {
    args: { ...args, audio: Array.from(args.audio) },
  });
}

// macOS-only: tells the Rust NSEvent monitor which modifier to intercept so
// the IMK log spam is suppressed. No-op on Linux/Windows. Safe to call on any
// platform — Rust ignores it off-Mac.
export async function sttHotkeySet(code: string): Promise<void> {
  return rawInvoke("stt_hotkey_set", { code });
}

// === Local (on-device) Whisper preset ===

export type SttTranscribeLocalArgs = {
  /** 16-bit PCM mono WAV blob from the recorder's forceWav path. */
  audio: Uint8Array;
  modelPath: string;
  language?: string;
};

export async function sttTranscribeLocal(
  args: SttTranscribeLocalArgs,
): Promise<string> {
  return rawInvoke<string>("stt_transcribe_local", {
    args: { ...args, audio: Array.from(args.audio) },
  });
}

export type SttModelStatus = {
  id: string;
  label: string;
  sizeMb: number;
  url: string;
  default: boolean;
  installed: boolean;
  path: string | null;
  installedBytes: number | null;
};

export type SttGpuStatus = {
  useGpu: boolean;
  /** "metal" | "vulkan" | "cuda" | "cpu" */
  backend: string;
};

export type SttModelListResponse = {
  models: SttModelStatus[];
  /** null until the first transcribe loads a model. */
  gpu: SttGpuStatus | null;
  /** Disk location where models live (for the "Stored in:" hint). */
  modelsDir: string | null;
};

export async function sttModelList(): Promise<SttModelListResponse> {
  return rawInvoke<SttModelListResponse>("stt_model_list");
}

export type SttDownloadProgress = {
  downloaded: number;
  total: number;
  done: boolean;
};

export async function sttModelDownload(
  id: string,
  onProgress: Channel<SttDownloadProgress>,
): Promise<string> {
  return rawInvoke<string>("stt_model_download", { id, onProgress });
}

/** Cancels an in-flight download. The matching `sttModelDownload` promise
 *  will reject with "aborted" and the `.part` file is cleaned up. */
export async function sttModelDownloadAbort(id: string): Promise<void> {
  return rawInvoke("stt_model_download_abort", { id });
}

export async function sttModelDelete(id: string): Promise<void> {
  return rawInvoke("stt_model_delete", { id });
}

export type AiChatArgs = {
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
};

export async function aiChat(args: AiChatArgs): Promise<string> {
  return rawInvoke<string>("ai_chat", { args });
}

// Streaming AI chat (Super Agent's previous Rust SSE path) was retired in the
// phase 6 pi-agent-framework cleanup. The webview now calls pi-ai directly:
// multi-turn via `superAgent/piRunner`, one-shot via `aiSuggest/piAiChat`.
// `aiChat` above remains for the Settings → AI Test Connection probe.

export async function clipboardSaveBlob(bytes: Uint8Array, ext: string): Promise<string> {
  return rawInvoke<string>("clipboard_save_blob", { bytes: Array.from(bytes), ext });
}

export type ScreenshotResult = { path: string; dataUrl: string };

/** Capture a rectangle in window-local physical pixels (origin = OS window's
 *  top-left, including chrome). Works while AnySpace is occluded / behind
 *  another app — the capture comes from the window's compositor surface,
 *  not the screen. Replaces the old monitor-based screenshotCaptureRegion. */
export async function screenshotCaptureWindowRegion(args: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<ScreenshotResult> {
  return rawInvoke<ScreenshotResult>("screenshot_capture_window_region", args);
}

export async function screenshotSavePngBytes(bytes: Uint8Array): Promise<string> {
  return rawInvoke<string>("screenshot_save_png_bytes", { bytes: Array.from(bytes) });
}

export type TeamPaths = {
  teamDir: string;
  boardPath: string;
  messagesPath: string;
  promptsDir: string;
  rpcDir: string;
  tmsgPath: string;
  tmsgBinDir: string;
};

export async function teamInit(args: {
  teamId: string;
  projectPath: string;
  boardMarkdown: string;
}): Promise<TeamPaths> {
  return rawInvoke<TeamPaths>("team_init", { args });
}

export async function teamWatchStart(teamId: string, teamDir: string): Promise<void> {
  return rawInvoke("team_watch_start", { teamId, teamDir });
}

export async function teamWatchStop(teamId: string): Promise<void> {
  return rawInvoke("team_watch_stop", { teamId });
}

export async function teamRpcReply(args: {
  teamDir: string;
  requestId: string;
  response: string;
}): Promise<void> {
  return rawInvoke("team_rpc_reply", { args });
}

export type PendingRpc = {
  requestId: string;
  reqPath: string;
  payload: string;
};

export async function teamRpcDrain(teamDir: string): Promise<PendingRpc[]> {
  return rawInvoke<PendingRpc[]>("team_rpc_drain", { teamDir });
}

export async function teamWritePrompt(args: {
  teamDir: string;
  label: string;
  body: string;
}): Promise<{ path: string }> {
  return rawInvoke<{ path: string }>("team_write_prompt", { args });
}

export type CompactResult = { total: number; archived: number; kept: number };

export async function teamCompactMessages(args: {
  teamDir: string;
  maxEntries: number;
  keepRecent: number;
}): Promise<CompactResult> {
  return rawInvoke<CompactResult>("team_compact_messages", { args });
}

export type TeamAppendMessageResult = {
  id: string;
  ts: string;
  path: string;
  appendedBytes: number;
};

export async function teamAppendMessage(args: {
  teamDir: string;
  id: string;
  from: string;
  to: string;
  type: string;
  ts: string;
  body: string;
}): Promise<TeamAppendMessageResult> {
  return rawInvoke<TeamAppendMessageResult>("team_append_message", { args });
}

export async function teamReadMessagesText(teamDir: string): Promise<string> {
  return rawInvoke<string>("team_read_messages_text", {
    args: { teamDir },
  });
}

export type TeamMessagesEvent = { teamId: string; messagesPath: string };
export type TeamRpcEvent = {
  teamId: string;
  requestId: string;
  reqPath: string;
  payload: string;
};

// === Agent API (loopback HTTP server backing $ANYSPACE_API_URL) ===
export type AgentApiInfo = {
  url: string;
  token: string;
  port: number;
};

export async function agentApiInfo(): Promise<AgentApiInfo> {
  return rawInvoke<AgentApiInfo>("agent_api_info");
}

export async function agentApiReply(args: {
  requestId: string;
  response: unknown;
}): Promise<void> {
  return rawInvoke("agent_api_reply", { args });
}

export type RotateResult = { token: string; requiresRestart: boolean };

export async function agentApiRotateToken(): Promise<RotateResult> {
  return rawInvoke<RotateResult>("agent_api_rotate_token");
}

export type AgentApiRequestEvent = {
  reqId: string;
  action: string;
  payload: Record<string, unknown>;
};

// SSH keychain CRUD. Passwords for stored SSH hosts live in the OS keychain
// (libsecret on Linux, Keychain on macOS, Credential Manager on Windows),
// keyed by the host's id. The host record itself only carries a non-secret
// `authMethod` flag.
export async function sshPasswordSet(hostId: string, password: string): Promise<void> {
  return rawInvoke("ssh_password_set", { hostId, password });
}

export async function sshPasswordGet(hostId: string): Promise<string | null> {
  return rawInvoke<string | null>("ssh_password_get", { hostId });
}

export async function sshPasswordDelete(hostId: string): Promise<void> {
  return rawInvoke("ssh_password_delete", { hostId });
}

/** Writes a one-shot SSH_ASKPASS script holding the password and returns
 *  the env vars that should be merged into the ssh child env. The script
 *  is auto-deleted after a short window. */
export async function sshAskpassPrepare(password: string): Promise<Record<string, string>> {
  return rawInvoke<Record<string, string>>("ssh_askpass_prepare", { password });
}

export { Channel };
