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
  const hotkey = useSttStore((s) => s.settings.hotkey);

  useEffect(() => {
    const expectedMod = modForCode(hotkey);
    const store = useSttStore;

    const onDown = (e: KeyboardEvent) => {
      if (e.repeat) return;

      if (e.code === hotkey) {
        if (hasForeignModifier(e, expectedMod)) return;
        if (isFormInput(e.target)) return;
        if (heldRef.current) return;
        heldRef.current = true;
        void store.getState().startListening();
        return;
      }

      // Any other key while listening cancels (treat as a real shortcut).
      if (heldRef.current) {
        heldRef.current = false;
        store.getState().cancel();
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code !== hotkey) return;
      if (!heldRef.current) return;
      heldRef.current = false;
      void store.getState().stopAndTranscribe();
    };

    const onBlur = () => {
      if (!heldRef.current) return;
      heldRef.current = false;
      store.getState().cancel();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden" && heldRef.current) {
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
      heldRef.current = false;
      void store.getState().stopAndTranscribe();
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
      for (const u of unlisten) u();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hotkey]);
}
