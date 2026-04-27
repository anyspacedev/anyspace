// Hold-to-talk hotkey detection, window-scoped.
// The hotkey is configurable in settings (e.g. ControlRight on Linux/Windows,
// AltRight on Mac). Cancels on any other key, on window blur, and on tab
// visibility loss.
//
// On macOS the modifier path is also driven by the Rust NSEvent monitor (see
// `stt/hotkey_monitor.rs`) emitting `stt://hotkey-down`/`up`. WebKit never
// dispatches the JS keydown for an intercepted modifier — that's the point,
// since IMK consultation on those events is what spams stderr — so we mirror
// the same heldRef state from both paths and let `startListening`/`cancel`/
// `stopAndTranscribe` dedupe at the store level.

import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { useSttStore } from "../../stores/sttStore";

// WebKitGTK on Linux X11 emits synthetic `keyup` → `keydown` pairs while a key
// is held (autorepeat) — and `e.repeat` isn't reliably set on the synthetic
// keydown. Without this debounce the first synthetic keyup tears the
// recording down a few ms after `startRecording` resolves, so the user holds
// for seconds but `stopRecording` reports duration=2ms. We defer keyup; if a
// matching hotkey keydown arrives inside this window, the keyup is autorepeat
// and we drop it. A real release has no following keydown, so the deferred
// handler fires normally.
const AUTOREPEAT_DEBOUNCE_MS = 50;

type ModFlag = "ctrlKey" | "altKey" | "metaKey" | "shiftKey" | null;
const ALL_MODS: Exclude<ModFlag, null>[] = [
  "ctrlKey",
  "altKey",
  "metaKey",
  "shiftKey",
];

function modForCode(code: string): ModFlag {
  if (code === "ControlLeft" || code === "ControlRight") return "ctrlKey";
  if (code === "AltLeft" || code === "AltRight") return "altKey";
  if (code === "MetaLeft" || code === "MetaRight") return "metaKey";
  if (code === "ShiftLeft" || code === "ShiftRight") return "shiftKey";
  return null;
}

function hasForeignModifier(e: KeyboardEvent, allowed: ModFlag): boolean {
  for (const m of ALL_MODS) {
    if (m === allowed) continue;
    if (e[m]) return true;
  }
  return false;
}

// xterm and Monaco both use a focused <textarea>, so allow textarea — we want
// dictation to work in those panes. Block plain inputs/selects so the hotkey
// doesn't steal keys while typing in the Settings overlay or other dialogs.
function isFormInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "SELECT";
}

export function useSttHotkey() {
  const heldRef = useRef(false);
  const pendingReleaseRef = useRef<number | null>(null);
  const hotkey = useSttStore((s) => s.settings.hotkey);

  useEffect(() => {
    const expectedMod = modForCode(hotkey);
    const store = useSttStore;

    const clearPendingRelease = () => {
      if (pendingReleaseRef.current !== null) {
        window.clearTimeout(pendingReleaseRef.current);
        pendingReleaseRef.current = null;
      }
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.code === hotkey) {
        if (hasForeignModifier(e, expectedMod)) return;
        if (isFormInput(e.target)) return;
        // X11 autorepeat: a synthetic keydown for the same hotkey arriving
        // while we're still debouncing the release means the key is actually
        // held. Cancel the pending release and stay in the listening state.
        if (pendingReleaseRef.current !== null) {
          clearPendingRelease();
          return;
        }
        if (e.repeat) return;
        if (heldRef.current) return;
        heldRef.current = true;
        void store.getState().startListening();
        return;
      }

      if (e.repeat) return;

      // Any other key while listening cancels (treat as a real shortcut).
      if (heldRef.current) {
        clearPendingRelease();
        heldRef.current = false;
        store.getState().cancel();
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code !== hotkey) return;
      if (!heldRef.current) return;
      clearPendingRelease();
      pendingReleaseRef.current = window.setTimeout(() => {
        pendingReleaseRef.current = null;
        if (!heldRef.current) return;
        heldRef.current = false;
        void store.getState().stopAndTranscribe();
      }, AUTOREPEAT_DEBOUNCE_MS);
    };

    const onBlur = () => {
      clearPendingRelease();
      if (!heldRef.current) return;
      heldRef.current = false;
      store.getState().cancel();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden" && heldRef.current) {
        clearPendingRelease();
        heldRef.current = false;
        store.getState().cancel();
      }
    };

    // macOS NSEvent monitor path. Linux/Windows builds never emit these
    // events, so the listeners just sit idle there.
    let cancelled = false;
    const unlisten: Array<() => void> = [];
    void listen<null>("stt://hotkey-down", () => {
      if (cancelled) return;
      if (pendingReleaseRef.current !== null) {
        clearPendingRelease();
        return;
      }
      if (heldRef.current) return;
      heldRef.current = true;
      void store.getState().startListening();
    }).then((u) => {
      if (cancelled) u();
      else unlisten.push(u);
    });
    void listen<null>("stt://hotkey-up", () => {
      if (cancelled) return;
      if (!heldRef.current) return;
      // The macOS NSEvent monitor delivers clean down/up edges, so debouncing
      // isn't strictly needed here, but mirroring the JS path keeps the state
      // machine consistent (e.g. if a future change starts emitting these on
      // Linux too).
      clearPendingRelease();
      pendingReleaseRef.current = window.setTimeout(() => {
        pendingReleaseRef.current = null;
        if (!heldRef.current) return;
        heldRef.current = false;
        void store.getState().stopAndTranscribe();
      }, AUTOREPEAT_DEBOUNCE_MS);
    }).then((u) => {
      if (cancelled) u();
      else unlisten.push(u);
    });

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearPendingRelease();
      for (const u of unlisten) u();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hotkey]);
}
