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
  taskTitle: string;
  taskBody: string;
  systemPrompt?: string;
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
};

export async function sttTranscribe(args: SttTranscribeArgs): Promise<string> {
  return rawInvoke<string>("stt_transcribe", {
    args: { ...args, audio: Array.from(args.audio) },
  });
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

export { Channel };
