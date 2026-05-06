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
import { MAX_RECORDING_MS, useSttStore } from "../../stores/sttStore";

// WebKitGTK on Linux fires *spurious* keyup events for modifier keys at 2–7 s
// intervals while the key is still held — and on real release, the keyup
// either never arrives or arrives with `getModifierState` still reporting the
// modifier as held. Two corroborating signals work around that:
//
//   1. `getModifierState`: when a keyup says the modifier is still held, it's
//      a spurious event and we ignore it (and reset the watchdog).
//   2. Watchdog: while heldRef is true, if no hotkey-related event fires for
//      `WATCHDOG_MS`, assume the user released. Pointer events with the
//      modifier reported released also short-circuit this — most users
//      reach for the mouse soon after release, which fires the cleanup
//      well before the watchdog timeout.
//
// The watchdog must be longer than `MAX_RECORDING_MS`: in some WebKitGTK
// builds (notably under remote/cloud desktop sessions) the spurious keyups
// don't fire at all during a held hotkey, so a short watchdog would truncate
// the recording even though the user is still holding. The recording cap in
// `sttStore.ts` is the real ceiling; the watchdog only catches the edge case
// where the hotkey listener is truly stuck after a missed release.
const AUTOREPEAT_DEBOUNCE_MS = 200;
const WATCHDOG_MS = MAX_RECORDING_MS + 5000;

// Maps a hotkey `KeyboardEvent.code` to the modifier-state name accepted by
// `KeyboardEvent.getModifierState` ("Control" / "Alt" / etc). On a real keyup
// the modifier is reported as released; on a synthetic autorepeat keyup most
// engines still report it as held. Used as a corroborating signal alongside
// the debounce.
function modifierStateName(code: string): string | null {
  if (code === "ControlLeft" || code === "ControlRight") return "Control";
  if (code === "AltLeft" || code === "AltRight") return "Alt";
  if (code === "MetaLeft" || code === "MetaRight") return "Meta";
  if (code === "ShiftLeft" || code === "ShiftRight") return "Shift";
  return null;
}

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

export function useSttHotkey() {
  const heldRef = useRef(false);
  const pendingReleaseRef = useRef<number | null>(null);
  const watchdogRef = useRef<number | null>(null);
  const hotkey = useSttStore((s) => s.settings.hotkey);

  useEffect(() => {
    const expectedMod = modForCode(hotkey);
    const modName = modifierStateName(hotkey);
    const store = useSttStore;

    const clearPendingRelease = () => {
      if (pendingReleaseRef.current !== null) {
        window.clearTimeout(pendingReleaseRef.current);
        pendingReleaseRef.current = null;
      }
    };

    const clearWatchdog = () => {
      if (watchdogRef.current !== null) {
        window.clearTimeout(watchdogRef.current);
        watchdogRef.current = null;
      }
    };

    const armWatchdog = () => {
      clearWatchdog();
      watchdogRef.current = window.setTimeout(() => {
        watchdogRef.current = null;
        if (!heldRef.current) return;
        console.debug(
          "[stt-hotkey] watchdog — no hotkey activity for %dms, assuming release ts=%d",
          WATCHDOG_MS,
          Math.round(performance.now()),
        );
        clearPendingRelease();
        heldRef.current = false;
        void store.getState().stopAndTranscribe();
      }, WATCHDOG_MS);
    };

    const finishRelease = (reason: string) => {
      clearWatchdog();
      clearPendingRelease();
      console.debug(
        "[stt-hotkey] release confirmed (%s) — stopAndTranscribe ts=%d",
        reason,
        Math.round(performance.now()),
      );
      heldRef.current = false;
      void store.getState().stopAndTranscribe();
    };

    const onDown = (e: KeyboardEvent) => {
      if (e.code === hotkey) {
        if (hasForeignModifier(e, expectedMod)) return;
        // Autorepeat: a hotkey keydown arriving while a release is being
        // debounced means the key is actually held. Cancel the pending
        // release and stay in the listening state.
        if (pendingReleaseRef.current !== null) {
          console.debug(
            "[stt-hotkey] keydown cancels pending release (autorepeat) repeat=%s ts=%d",
            e.repeat,
            Math.round(performance.now()),
          );
          clearPendingRelease();
          armWatchdog();
          return;
        }
        if (e.repeat) {
          armWatchdog();
          return;
        }
        if (heldRef.current) {
          armWatchdog();
          return;
        }
        console.debug(
          "[stt-hotkey] keydown — start listening code=%s ts=%d",
          e.code,
          Math.round(performance.now()),
        );
        heldRef.current = true;
        armWatchdog();
        void store.getState().startListening();
        return;
      }

      if (e.repeat) return;

      // Any other key while listening cancels (treat as a real shortcut).
      if (heldRef.current) {
        clearWatchdog();
        clearPendingRelease();
        heldRef.current = false;
        store.getState().cancel();
      }
    };

    const onUp = (e: KeyboardEvent) => {
      if (e.code !== hotkey) return;
      if (!heldRef.current) return;
      // If the modifier state still reports the key as held, it's a spurious
      // WebKitGTK keyup. Reset the watchdog and otherwise ignore.
      if (modName && e.getModifierState(modName)) {
        console.debug(
          "[stt-hotkey] keyup ignored — %s still held (spurious) ts=%d",
          modName,
          Math.round(performance.now()),
        );
        armWatchdog();
        return;
      }
      console.debug(
        "[stt-hotkey] keyup — arming %dms release debounce code=%s ts=%d",
        AUTOREPEAT_DEBOUNCE_MS,
        e.code,
        Math.round(performance.now()),
      );
      clearPendingRelease();
      pendingReleaseRef.current = window.setTimeout(() => {
        pendingReleaseRef.current = null;
        if (!heldRef.current) return;
        finishRelease("keyup state=false");
      }, AUTOREPEAT_DEBOUNCE_MS);
    };

    // Pointer events also carry getModifierState. While we're holding, if the
    // user moves/clicks the mouse, we can confirm the release without waiting
    // for the watchdog. Most users do this within ~1 s of releasing.
    const onPointerActivity = (e: MouseEvent) => {
      if (!heldRef.current) return;
      if (!modName) return;
      if (e.getModifierState(modName)) return;
      finishRelease("pointer event state=false");
    };

    const onBlur = () => {
      clearWatchdog();
      clearPendingRelease();
      if (!heldRef.current) return;
      heldRef.current = false;
      store.getState().cancel();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden" && heldRef.current) {
        clearWatchdog();
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
        armWatchdog();
        return;
      }
      if (heldRef.current) {
        armWatchdog();
        return;
      }
      heldRef.current = true;
      armWatchdog();
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
      // machine consistent.
      clearPendingRelease();
      pendingReleaseRef.current = window.setTimeout(() => {
        pendingReleaseRef.current = null;
        if (!heldRef.current) return;
        finishRelease("tauri hotkey-up");
      }, AUTOREPEAT_DEBOUNCE_MS);
    }).then((u) => {
      if (cancelled) u();
      else unlisten.push(u);
    });

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("mousemove", onPointerActivity);
    window.addEventListener("mousedown", onPointerActivity);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearPendingRelease();
      clearWatchdog();
      for (const u of unlisten) u();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("mousemove", onPointerActivity);
      window.removeEventListener("mousedown", onPointerActivity);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hotkey]);
}
