import { create } from "zustand";
import { settingsGet, settingsSet, sttHotkeySet, sttTranscribe } from "../lib/tauri";
import {
  cancelRecording,
  isRecording,
  startRecording,
  stopRecording,
} from "../components/stt/recorder";
import { inject, type InjectTarget } from "../components/stt/inject";
import { useWorkspaceStore } from "./workspaceStore";

export type SttPhase =
  | "idle"
  | "listening"
  | "transcribing"
  | "success"
  | "error";

export type SttSettings = {
  endpoint: string;
  apiKey: string;
  model: string;
  language: string; // empty = auto-detect
  presetId: "groq" | "openai" | "custom";
  // KeyboardEvent.code of the hold-to-talk hotkey. Apple-built keyboards have
  // no Right Control key, so the default differs by platform; user can rebind
  // in Settings.
  hotkey: string;
};

function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const platform = (navigator as { platform?: string }).platform || "";
  return /Mac|iPhone|iPad|iPod/.test(platform) || /Mac OS X/.test(ua);
}

export function defaultHotkey(): string {
  return isMacPlatform() ? "AltRight" : "ControlRight";
}

const DEFAULT_SETTINGS: SttSettings = {
  endpoint: "https://api.groq.com/openai/v1",
  apiKey: "",
  model: "whisper-large-v3-turbo",
  language: "",
  presetId: "groq",
  hotkey: defaultHotkey(),
};

const SETTINGS_KEY = "stt";

// Recordings shorter than this are treated as accidental key-taps.
const MIN_RECORDING_MS = 350;

type SttState = {
  phase: SttPhase;
  message: string;
  analyser: AnalyserNode | null;
  settings: SttSettings;
  loaded: boolean;

  load: () => Promise<void>;
  updateSettings: (partial: Partial<SttSettings>) => Promise<void>;

  startListening: () => Promise<void>;
  stopAndTranscribe: () => Promise<void>;
  cancel: () => void;
  dismiss: () => void;
};

let activeTarget: InjectTarget | null = null;
let dismissTimer: number | undefined;
// Bumped on cancel(); after each async hop in startListening / stopAndTranscribe
// we re-check it to bail out cleanly when a cancel fired mid-flight.
let startGen = 0;

function snapshotActiveTarget(): InjectTarget {
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (!tab) return { kind: "none", label: "no workspace" };
  const paneId = tab.activePaneId;
  const pane = paneId ? tab.panes[paneId] : null;
  if (!pane) return { kind: "none", label: "no pane" };

  if (pane.kind === "terminal") {
    const sessionId = pane.payload?.sessionId as string | undefined;
    if (!sessionId) return { kind: "none", label: "terminal not ready" };
    return { kind: "terminal", sessionId, label: "terminal" };
  }
  if (pane.kind === "editor") {
    return { kind: "editor", paneId: pane.id, label: "editor" };
  }
  return { kind: "none", label: pane.kind };
}

function clearDismissTimer() {
  if (dismissTimer !== undefined) {
    window.clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }
}

function scheduleDismiss(set: (s: Partial<SttState>) => void, delayMs: number) {
  clearDismissTimer();
  dismissTimer = window.setTimeout(() => {
    set({ phase: "idle", message: "", analyser: null });
    dismissTimer = undefined;
  }, delayMs);
}

export const useSttStore = create<SttState>((set, get) => ({
  phase: "idle",
  message: "",
  analyser: null,
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const stored = await settingsGet<Partial<SttSettings>>(SETTINGS_KEY);
      if (stored) {
        set({ settings: { ...DEFAULT_SETTINGS, ...stored }, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
    void sttHotkeySet(get().settings.hotkey).catch(() => {
      /* best-effort — Rust monitor falls back to its idle state */
    });
  },

  updateSettings: async (partial) => {
    const prev = get().settings;
    const next = { ...prev, ...partial };
    set({ settings: next });
    if (next.hotkey !== prev.hotkey) {
      void sttHotkeySet(next.hotkey).catch(() => {
        /* best-effort */
      });
    }
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* ignore — settings persistence is best-effort */
    }
  },

  startListening: async () => {
    if (get().phase !== "idle") return;
    clearDismissTimer();

    if (!get().settings.apiKey) {
      set({
        phase: "error",
        message: "No API key — open Settings → Speech to text",
        analyser: null,
      });
      scheduleDismiss(set, 4000);
      return;
    }

    activeTarget = snapshotActiveTarget();
    const gen = ++startGen;
    // Pre-mark phase so a synchronous cancel() during the async await
    // sees a non-idle state and tears down properly.
    set({ phase: "listening", message: "", analyser: null });
    try {
      const { analyser } = await startRecording();
      // If a concurrent cancel/stop fired while getUserMedia was pending,
      // bail out — recorder.ts cleanup already happened.
      if (gen !== startGen || get().phase !== "listening") {
        cancelRecording();
        return;
      }
      set({ analyser });
    } catch (e) {
      if (gen !== startGen) return;
      const msg =
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission denied"
          : `Mic error: ${e instanceof Error ? e.message : String(e)}`;
      set({ phase: "error", message: msg, analyser: null });
      scheduleDismiss(set, 4000);
    }
  },

  stopAndTranscribe: async () => {
    if (get().phase !== "listening") {
      // hotkey released without an active recording — treat as no-op
      if (isRecording()) cancelRecording();
      return;
    }

    if (!isRecording()) {
      // getUserMedia hadn't resolved yet — treat as cancel
      get().cancel();
      return;
    }

    let result: Awaited<ReturnType<typeof stopRecording>>;
    try {
      result = await stopRecording();
    } catch (e) {
      set({
        phase: "error",
        message: `Recorder error: ${e instanceof Error ? e.message : String(e)}`,
        analyser: null,
      });
      scheduleDismiss(set, 4000);
      return;
    }

    if (result.durationMs < MIN_RECORDING_MS) {
      set({
        phase: "error",
        message: "Hold longer to dictate",
        analyser: null,
      });
      scheduleDismiss(set, 1500);
      return;
    }

    set({ phase: "transcribing", message: "Transcribing…", analyser: null });

    const gen = startGen;
    const { settings } = get();
    try {
      const audio = new Uint8Array(await result.blob.arrayBuffer());
      if (gen !== startGen) return;

      const text = await sttTranscribe({
        endpoint: settings.endpoint,
        apiKey: settings.apiKey,
        model: settings.model,
        language: settings.language || undefined,
        audio,
        mime: result.mime,
        filename: filenameFor(result.mime),
      });
      if (gen !== startGen) return;

      const target = activeTarget ?? { kind: "none", label: "no target" };
      const out = await inject(text, target);
      if (gen !== startGen) return;

      if (out.ok) {
        set({ phase: "success", message: out.message, analyser: null });
        scheduleDismiss(set, 1400);
      } else {
        set({ phase: "error", message: out.message, analyser: null });
        scheduleDismiss(set, 4000);
      }
    } catch (e) {
      if (gen !== startGen) return;
      set({
        phase: "error",
        message: e instanceof Error ? e.message : String(e),
        analyser: null,
      });
      scheduleDismiss(set, 4000);
    } finally {
      // Only clear if we still own this generation — otherwise cancel() (or a
      // fresh startListening) has already managed activeTarget.
      if (gen === startGen) activeTarget = null;
    }
  },

  cancel: () => {
    const phase = get().phase;
    startGen++; // invalidate any pending startRecording / transcribe / inject
    if (phase === "listening") {
      // either recording or in-flight getUserMedia — both safe to cancel
      cancelRecording();
    }
    activeTarget = null;
    clearDismissTimer();
    set({ phase: "idle", message: "", analyser: null });
  },

  dismiss: () => {
    clearDismissTimer();
    set({ phase: "idle", message: "", analyser: null });
  },
}));

function filenameFor(mime: string): string {
  if (mime.includes("ogg")) return "audio.ogg";
  if (mime.includes("mp4")) return "audio.mp4";
  return "audio.webm";
}
