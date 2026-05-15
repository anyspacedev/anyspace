import { create } from "zustand";
import {
  settingsGet,
  settingsSet,
  sttHotkeySet,
  sttTranscribe,
  sttTranscribeLocal,
} from "../lib/tauri";
import { ANYSPACE_CLOUD_URL, getAuthToken, isSignedIn } from "../lib/auth";
import { tryHandleQuotaError } from "../lib/quotaError";
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

export type BubblePos = { x: number; y: number };

export type SttSettings = {
  endpoint: string;
  apiKey: string;
  model: string;
  language: string; // empty = auto-detect
  presetId:
    | "groq"
    | "openai"
    | "elevenlabs"
    | "anyspace-cloud"
    | "local-whisper"
    | "custom";
  // KeyboardEvent.code of the hold-to-talk hotkey. Apple-built keyboards have
  // no Right Control key, so the default differs by platform; user can rebind
  // in Settings.
  hotkey: string;
  // Persisted screen position of the floating bubble. null = default
  // (bottom-center, driven by CSS).
  bubblePos: BubblePos | null;
  // === Local Whisper preset ===
  // Curated model id from src-tauri/src/stt/models.rs (`tiny`, `base`,
  // `small`, `large-v3-turbo-q8`). Used only when presetId === "local-whisper".
  localModelId: string;
  // Last successfully-resolved model path. Populated by the Settings panel
  // when the chosen model is verified present; consulted at transcribe time
  // so we don't re-stat on every hotkey press.
  localModelPath: string;
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
  bubblePos: null,
  localModelId: "small",
  localModelPath: "",
};

const SETTINGS_KEY = "stt";

// Recordings shorter than this are treated as accidental key-taps.
const MIN_RECORDING_MS = 350;
// Hard cap on a single recording. We auto-stop and transcribe whatever we
// captured up to this point, so a stuck modifier never records indefinitely.
export const MAX_RECORDING_MS = 60_000;
// When `remainingMs` drops below this, the bubble shows a countdown digit.
export const COUNTDOWN_MS = 5_000;
const TICK_MS = 100;

type SttState = {
  phase: SttPhase;
  message: string;
  analyser: AnalyserNode | null;
  settings: SttSettings;
  loaded: boolean;
  // While listening, ticked every TICK_MS so the bubble can render a countdown
  // in the last few seconds. Reset to 0 / MAX_RECORDING_MS once recording ends.
  elapsedMs: number;
  remainingMs: number;

  load: () => Promise<void>;
  updateSettings: (partial: Partial<SttSettings>) => Promise<void>;
  // Persists bubble position without going through the hotkey-rebind path.
  setBubblePos: (pos: BubblePos) => void;

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
// Recording-window timers. Cleared on every exit path out of `listening`.
let tickTimer: number | undefined;
let maxDurationTimer: number | undefined;
let recordingStartedAt = 0;

// xterm and Monaco both focus an internal <textarea>; pane-based dispatch
// (ptyWrite / executeEdits) is the only correct path for those, so we filter
// them out before treating a focused element as a generic DOM input.
function isInsideTerminalOrEditor(el: Element): boolean {
  return Boolean(
    el.closest(".xterm") ||
      el.closest(".xterm-helper-textarea") ||
      el.closest(".monaco-editor"),
  );
}

const NON_TEXT_INPUT_TYPES = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "file",
  "color",
  "range",
  "image",
  "hidden",
]);

function isWritableInput(
  el: Element,
): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) {
    return !el.readOnly && !el.disabled;
  }
  if (el instanceof HTMLInputElement) {
    if (el.readOnly || el.disabled) return false;
    if (NON_TEXT_INPUT_TYPES.has(el.type)) return false;
    return true;
  }
  return false;
}

function labelForInput(el: HTMLInputElement | HTMLTextAreaElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  if (el.placeholder && el.placeholder.trim()) return el.placeholder.trim();
  if (el.name && el.name.trim()) return el.name.trim();
  return el instanceof HTMLTextAreaElement ? "textarea" : "input";
}

function snapshotActiveTarget(): InjectTarget {
  // Focused DOM element wins — covers Settings inputs, Kanban editors, etc.
  // Only fall through to pane-based dispatch if the focus isn't on a writable
  // text element outside xterm/Monaco's internals.
  const active =
    typeof document !== "undefined" ? document.activeElement : null;
  if (active instanceof HTMLElement && !isInsideTerminalOrEditor(active)) {
    if (isWritableInput(active)) {
      return { kind: "dom-input", element: active, label: labelForInput(active) };
    }
    if (active.isContentEditable) {
      return { kind: "dom-contenteditable", element: active, label: "editable" };
    }
  }

  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (!tab) return { kind: "none", label: "no workspace" };
  const paneId = tab.activePaneId;
  const pane = paneId ? tab.panes[paneId] : null;
  if (!pane) return { kind: "none", label: "no pane" };

  if (pane.kind === "terminal") {
    const sessionId = pane.payload?.sessionId as string | undefined;
    if (!sessionId) return { kind: "none", label: "terminal not ready" };
    return { kind: "terminal", sessionId, paneId: pane.id, label: "terminal" };
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

function clearRecordingTimers(set: (s: Partial<SttState>) => void) {
  if (tickTimer !== undefined) {
    window.clearInterval(tickTimer);
    tickTimer = undefined;
  }
  if (maxDurationTimer !== undefined) {
    window.clearTimeout(maxDurationTimer);
    maxDurationTimer = undefined;
  }
  set({ elapsedMs: 0, remainingMs: MAX_RECORDING_MS });
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
  elapsedMs: 0,
  remainingMs: MAX_RECORDING_MS,

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

  setBubblePos: (pos) => {
    const prev = get().settings;
    const next = { ...prev, bubblePos: pos };
    set({ settings: next });
    void settingsSet(SETTINGS_KEY, next).catch(() => {
      /* ignore — bubble position persistence is best-effort */
    });
  },

  startListening: async () => {
    if (get().phase !== "idle") {
      console.debug("[stt] startListening ignored — phase=", get().phase);
      return;
    }
    clearDismissTimer();

    const presetId = get().settings.presetId;
    if (presetId === "anyspace-cloud") {
      if (!isSignedIn()) {
        console.warn("[stt] startListening blocked — AnySpace Cloud requires sign-in");
        set({
          phase: "error",
          message: "Sign in to use AnySpace Cloud — Settings → Speech to text",
          analyser: null,
        });
        scheduleDismiss(set, 4000);
        return;
      }
    } else if (presetId === "local-whisper") {
      if (!get().settings.localModelPath) {
        console.warn("[stt] startListening blocked — no local model selected");
        set({
          phase: "error",
          message: "Download a Whisper model first — Settings → Speech to text",
          analyser: null,
        });
        scheduleDismiss(set, 4000);
        return;
      }
    } else if (!get().settings.apiKey) {
      console.warn("[stt] startListening blocked — no API key configured");
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
    console.log(
      "[stt] startListening preset=%s target=%s",
      get().settings.presetId,
      activeTarget.kind + (activeTarget.label ? ` (${activeTarget.label})` : ""),
    );
    // Pre-mark phase so a synchronous cancel() during the async await
    // sees a non-idle state and tears down properly.
    set({ phase: "listening", message: "", analyser: null });
    try {
      // Local Whisper can't decode opus; force the recorder's WAV path so
      // the backend gets a blob whisper.cpp accepts directly.
      const forceWav = presetId === "local-whisper";
      const { analyser } = await startRecording({ forceWav });
      // If a concurrent cancel/stop fired while getUserMedia was pending,
      // bail out — recorder.ts cleanup already happened.
      if (gen !== startGen || get().phase !== "listening") {
        cancelRecording();
        return;
      }
      recordingStartedAt = performance.now();
      console.debug("[stt] recording started — max=%dms", MAX_RECORDING_MS);
      set({ analyser, elapsedMs: 0, remainingMs: MAX_RECORDING_MS });
      tickTimer = window.setInterval(() => {
        const elapsed = performance.now() - recordingStartedAt;
        set({
          elapsedMs: elapsed,
          remainingMs: Math.max(0, MAX_RECORDING_MS - elapsed),
        });
      }, TICK_MS);
      // Hard cap: same teardown path as a normal release. If a cancel fires
      // before this triggers, clearRecordingTimers cancels the timeout.
      maxDurationTimer = window.setTimeout(() => {
        if (gen !== startGen) return;
        if (useSttStore.getState().phase !== "listening") return;
        void useSttStore.getState().stopAndTranscribe();
      }, MAX_RECORDING_MS);
    } catch (e) {
      if (gen !== startGen) return;
      const msg =
        e instanceof Error && e.name === "NotAllowedError"
          ? "Microphone permission denied"
          : `Mic error: ${e instanceof Error ? e.message : String(e)}`;
      console.error("[stt] startRecording failed:", e);
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

    // From here on the recording is ending one way or another — kill the cap
    // timer so it can't fire again, and freeze the countdown UI.
    clearRecordingTimers(set);

    let result: Awaited<ReturnType<typeof stopRecording>>;
    try {
      result = await stopRecording();
    } catch (e) {
      console.error("[stt] stopRecording failed:", e);
      set({
        phase: "error",
        message: `Recorder error: ${e instanceof Error ? e.message : String(e)}`,
        analyser: null,
      });
      scheduleDismiss(set, 4000);
      return;
    }

    console.debug(
      "[stt] recorded duration=%dms mime=%s bytes=%d",
      Math.round(result.durationMs),
      result.mime,
      result.blob.size,
    );

    if (result.durationMs < MIN_RECORDING_MS) {
      console.debug(
        "[stt] discarded — duration %dms below MIN_RECORDING_MS=%d",
        Math.round(result.durationMs),
        MIN_RECORDING_MS,
      );
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

    // Local Whisper: short-circuit the remote-endpoint code path entirely.
    // No endpoint, no API key, no provider routing.
    if (settings.presetId === "local-whisper") {
      try {
        const audio = new Uint8Array(await result.blob.arrayBuffer());
        if (gen !== startGen) return;
        console.log(
          "[stt] sttTranscribeLocal → model=%s lang=%s bytes=%d",
          settings.localModelId,
          settings.language || "(auto)",
          audio.byteLength,
        );
        const t0 = performance.now();
        const text = await sttTranscribeLocal({
          audio,
          modelPath: settings.localModelPath,
          language: settings.language || undefined,
        });
        const elapsedMs = Math.round(performance.now() - t0);
        if (gen !== startGen) return;
        console.log(
          '[stt] local transcribed %dms chars=%d preview="%s"',
          elapsedMs,
          text.length,
          text.slice(0, 60).replace(/\n/g, " "),
        );
        // Empty result = whisper.cpp returned only sentinel markers
        // (`[BLANK_AUDIO]` etc.) which we stripped backend-side. Surface
        // a brief message instead of injecting nothing.
        if (!text) {
          set({ phase: "error", message: "No speech detected", analyser: null });
          scheduleDismiss(set, 1500);
          return;
        }
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
        console.error("[stt] local transcribe/inject failed:", e);
        set({
          phase: "error",
          message: e instanceof Error ? e.message : String(e),
          analyser: null,
        });
        scheduleDismiss(set, 4000);
      } finally {
        if (gen === startGen) activeTarget = null;
      }
      return;
    }

    const provider: "openai" | "elevenlabs" =
      settings.presetId === "elevenlabs" ? "elevenlabs" : "openai";

    // AnySpace Cloud uses the OpenAI-shaped endpoint with a Clerk JWT
    // injected in place of an API key. Mint it fresh per call (Clerk
    // tokens TTL ~60s; never persist).
    let endpoint = settings.endpoint;
    let apiKey = settings.apiKey;
    if (settings.presetId === "anyspace-cloud") {
      if (!isSignedIn()) {
        set({
          phase: "error",
          message: "Sign in to use AnySpace Cloud (Settings → Account)",
          analyser: null,
        });
        scheduleDismiss(set, 2500);
        return;
      }
      const token = await getAuthToken();
      if (!token) {
        set({
          phase: "error",
          message: "Could not get auth token — try signing in again",
          analyser: null,
        });
        scheduleDismiss(set, 2500);
        return;
      }
      endpoint = ANYSPACE_CLOUD_URL;
      apiKey = token;
    }
    try {
      const audio = new Uint8Array(await result.blob.arrayBuffer());
      if (gen !== startGen) {
        console.debug("[stt] aborted before transcribe — gen mismatch");
        return;
      }

      console.log(
        "[stt] sttTranscribe → preset=%s endpoint=%s model=%s lang=%s bytes=%d",
        settings.presetId,
        endpoint,
        settings.model,
        settings.language || "(auto)",
        audio.byteLength,
      );
      const t0 = performance.now();
      const text = await sttTranscribe({
        endpoint,
        apiKey,
        model: settings.model,
        language: settings.language || undefined,
        audio,
        mime: result.mime,
        filename: filenameFor(result.mime),
        provider,
      });
      const elapsedMs = Math.round(performance.now() - t0);
      if (gen !== startGen) {
        console.debug("[stt] aborted after transcribe — gen mismatch");
        return;
      }
      console.log(
        '[stt] transcribed %dms chars=%d preview="%s"',
        elapsedMs,
        text.length,
        text.slice(0, 60).replace(/\n/g, " "),
      );

      const target = activeTarget ?? { kind: "none", label: "no target" };
      const out = await inject(text, target);
      if (gen !== startGen) {
        console.debug("[stt] aborted after inject — gen mismatch");
        return;
      }
      console.log(
        "[stt] inject → ok=%s fallback=%s target=%s msg=%s",
        out.ok,
        out.fallback ?? "none",
        target.kind,
        out.message,
      );

      if (out.ok) {
        set({ phase: "success", message: out.message, analyser: null });
        scheduleDismiss(set, 1400);
      } else {
        set({ phase: "error", message: out.message, analyser: null });
        scheduleDismiss(set, 4000);
      }
    } catch (e) {
      if (gen !== startGen) {
        console.debug("[stt] error after gen mismatch (suppressed):", e);
        return;
      }
      console.error("[stt] transcribe/inject failed provider=%s:", provider, e);
      // 402 quota: handled by quotaError (toast + meter refresh). The bubble
      // still shows a brief "limit reached" message so the user knows their
      // recording was dropped on purpose, not silently lost.
      const handledAsQuota = tryHandleQuotaError(e);
      set({
        phase: "error",
        message: handledAsQuota
          ? "Free speech-to-text limit reached"
          : (e instanceof Error ? e.message : String(e)),
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
    if (phase !== "idle") {
      console.debug("[stt] cancel from phase=%s", phase);
    }
    startGen++; // invalidate any pending startRecording / transcribe / inject
    if (phase === "listening") {
      // either recording or in-flight getUserMedia — both safe to cancel
      cancelRecording();
    }
    activeTarget = null;
    clearDismissTimer();
    clearRecordingTimers(set);
    set({ phase: "idle", message: "", analyser: null });
  },

  dismiss: () => {
    clearDismissTimer();
    clearRecordingTimers(set);
    set({ phase: "idle", message: "", analyser: null });
  },
}));

function filenameFor(mime: string): string {
  if (mime.includes("ogg")) return "audio.ogg";
  if (mime.includes("mp4")) return "audio.mp4";
  if (mime.includes("wav")) return "audio.wav";
  return "audio.webm";
}
