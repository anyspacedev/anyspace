// Right Ctrl hold-to-talk detection, window-scoped.
// Cancels on any other key, on window blur, and on tab visibility loss.

import { useEffect, useRef } from "react";
import { useSttStore } from "../../stores/sttStore";

export function useSttHotkey() {
  const heldRef = useRef(false);

  useEffect(() => {
    const store = useSttStore;

    const onDown = (e: KeyboardEvent) => {
      // ignore key repeats
      if (e.repeat) return;

      if (e.code === "ControlRight") {
        // require Right Ctrl alone (no other modifiers active)
        if (e.altKey || e.metaKey || e.shiftKey) return;
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
      if (e.code !== "ControlRight") return;
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

    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
