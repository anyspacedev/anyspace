import { invoke as rawInvoke, Channel } from "@tauri-apps/api/core";

// Typed wrappers for our Rust commands.

export type SessionId = string;

export type SpawnArgs = {
  cwd?: string;
  env?: Record<string, string>;
  cols: number;
  rows: number;
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

// === Streaming ai chat (Super Agent) ===
export type AiMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: AiToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type AiToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type AiToolDef = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ChatStreamArgs = {
  endpoint: string;
  apiKey: string;
  model: string;
  messages: AiMessage[];
  tools?: AiToolDef[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  streaming?: boolean;
};

export type AiStreamEvent =
  | { type: "delta"; content: string }
  | {
      type: "tool_call_delta";
      index: number;
      id?: string;
      name?: string;
      arguments_partial?: string;
    }
  | { type: "done"; finish_reason?: string }
  | { type: "error"; message: string };

export type AiStreamHandle = {
  streamId: string;
  abort: () => Promise<void>;
};

export async function aiChatStream(
  args: ChatStreamArgs,
  onEvent: (ev: AiStreamEvent) => void,
): Promise<AiStreamHandle> {
  const channel = new Channel<AiStreamEvent>();
  channel.onmessage = (ev) => onEvent(ev);
  const streamId = await rawInvoke<string>("ai_chat_stream", { args, onEvent: channel });
  return {
    streamId,
    abort: () => rawInvoke<void>("abort_ai_chat_stream", { streamId }),
  };
}

export async function clipboardSaveBlob(bytes: Uint8Array, ext: string): Promise<string> {
  return rawInvoke<string>("clipboard_save_blob", { bytes: Array.from(bytes), ext });
}

export type ScreenshotResult = { path: string; dataUrl: string };

export async function screenshotCaptureRegion(args: {
  x: number;
  y: number;
  width: number;
  height: number;
}): Promise<ScreenshotResult> {
  return rawInvoke<ScreenshotResult>("screenshot_capture_region", args);
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

export type TeamMessagesEvent = { teamId: string; messagesPath: string };
export type TeamRpcEvent = {
  teamId: string;
  requestId: string;
  reqPath: string;
  payload: string;
};

export { Channel };
