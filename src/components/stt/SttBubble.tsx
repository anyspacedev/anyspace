import { useEffect, useRef, useState } from "react";
import {
  COUNTDOWN_MS,
  useSttStore,
  type BubblePos,
} from "../../stores/sttStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Icon } from "../ui/Icon";
import { Waveform } from "./Waveform";
import { useSttHotkey } from "./useSttHotkey";

const DRAG_THRESHOLD = 4;
// How long the user must press without moving before we treat it as a
// hold-to-talk gesture. Below this threshold a release is a stray click;
// movement past DRAG_THRESHOLD switches the gesture to drag-to-move.
const HOLD_INTENT_MS = 120;
// Keep this many px between the bubble and the viewport edges so it never
// clips when restored from a saved position on a smaller window.
const EDGE_MARGIN = 8;

type Mode = "idle" | "pending" | "recording" | "dragging";

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampToViewport(p: BubblePos, w: number, h: number): BubblePos {
  return {
    x: clamp(p.x, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerWidth - w - EDGE_MARGIN)),
    y: clamp(p.y, EDGE_MARGIN, Math.max(EDGE_MARGIN, window.innerHeight - h - EDGE_MARGIN)),
  };
}

function displayHotkey(code: string): string {
  switch (code) {
    case "ControlRight": return "Right Ctrl";
    case "ControlLeft": return "Left Ctrl";
    case "AltRight": return "Right Alt";
    case "AltLeft": return "Left Alt";
    case "MetaRight": return "Right ⌘";
    case "MetaLeft": return "Left ⌘";
    case "ShiftRight": return "Right Shift";
    case "ShiftLeft": return "Left Shift";
    default: return code;
  }
}

export function SttBubble() {
  useSttHotkey();
  const phase = useSttStore((s) => s.phase);
  const message = useSttStore((s) => s.message);
  const analyser = useSttStore((s) => s.analyser);
  const remainingMs = useSttStore((s) => s.remainingMs);
  const hotkey = useSttStore((s) => s.settings.hotkey);
  const persistedPos = useSttStore((s) => s.settings.bubblePos);
  const setBubblePos = useSttStore((s) => s.setBubblePos);
  const dismiss = useSttStore((s) => s.dismiss);
  const setView = useWorkspaceStore((s) => s.setView);

  const [pos, setPos] = useState<BubblePos | null>(persistedPos);
  const [dragging, setDragging] = useState(false);

  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const modeRef = useRef<Mode>("idle");
  const intentTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPos(persistedPos);
  }, [persistedPos]);

  // Re-clamp on viewport resize so a saved position stays inside the window.
  useEffect(() => {
    const onResize = () => {
      const cur = pos;
      if (!cur) return;
      const rect = bubbleRef.current?.getBoundingClientRect();
      if (!rect) return;
      const next = clampToViewport(cur, rect.width, rect.height);
      if (next.x !== cur.x || next.y !== cur.y) {
        setPos(next);
        setBubblePos(next);
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [pos, setBubblePos]);

  useEffect(() => {
    return () => {
      if (intentTimerRef.current !== null) {
        window.clearTimeout(intentTimerRef.current);
        intentTimerRef.current = null;
      }
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Buttons (Open Settings / dismiss / etc.) keep their own click semantics.
    if ((e.target as HTMLElement).closest("button")) return;

    const elem = e.currentTarget;
    const pointerId = e.pointerId;
    try {
      elem.setPointerCapture(pointerId);
    } catch {
      // capture can fail if pointer was already released; safe to ignore
    }

    const rect = elem.getBoundingClientRect();
    const size = { w: rect.width, h: rect.height };
    const offset = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    const startX = e.clientX;
    const startY = e.clientY;
    let latestPos: BubblePos | null = null;

    const fireHoldIntent = () => {
      intentTimerRef.current = null;
      if (modeRef.current !== "pending") return;
      // Only escalate to recording from a true idle bubble. If a keyboard hold
      // is already in flight (or we're transcribing/showing an error), the
      // mouse press is treated as a no-op press until release/drag resolves.
      if (useSttStore.getState().phase !== "idle") return;
      modeRef.current = "recording";
      void useSttStore.getState().startListening();
    };

    modeRef.current = "pending";
    intentTimerRef.current = window.setTimeout(fireHoldIntent, HOLD_INTENT_MS);

    const teardown = () => {
      elem.removeEventListener("pointermove", onMove);
      elem.removeEventListener("pointerup", onUp);
      elem.removeEventListener("pointercancel", onCancel);
      if (elem.hasPointerCapture(pointerId)) {
        try { elem.releasePointerCapture(pointerId); } catch { /* ignore */ }
      }
      document.body.style.userSelect = "";
      if (intentTimerRef.current !== null) {
        window.clearTimeout(intentTimerRef.current);
        intentTimerRef.current = null;
      }
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const movedPastThreshold = Math.hypot(dx, dy) >= DRAG_THRESHOLD;
      // Movement promotes the gesture to a drag even after the hold-intent
      // timer already escalated us to "recording": a slow tap-and-drag can
      // cross 4px only after 120ms, and without this branch the bubble would
      // silently capture audio while the user is just repositioning it.
      if (
        movedPastThreshold &&
        (modeRef.current === "pending" || modeRef.current === "recording")
      ) {
        if (intentTimerRef.current !== null) {
          window.clearTimeout(intentTimerRef.current);
          intentTimerRef.current = null;
        }
        if (modeRef.current === "recording") {
          useSttStore.getState().cancel();
        }
        modeRef.current = "dragging";
        setDragging(true);
        document.body.style.userSelect = "none";
      } else if (modeRef.current === "pending" && intentTimerRef.current !== null) {
        // Sub-threshold movement: the user is mid-gesture, not holding still.
        // Push the hold-intent deadline back so recording only kicks in once
        // the bubble has actually been stationary for HOLD_INTENT_MS — this
        // avoids a recording flash when a slow drag never quite stops moving.
        window.clearTimeout(intentTimerRef.current);
        intentTimerRef.current = window.setTimeout(fireHoldIntent, HOLD_INTENT_MS);
      }
      if (modeRef.current === "dragging") {
        const next = clampToViewport(
          { x: ev.clientX - offset.dx, y: ev.clientY - offset.dy },
          size.w,
          size.h,
        );
        latestPos = next;
        setPos(next);
      }
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const m = modeRef.current;
      modeRef.current = "idle";
      teardown();
      if (m === "recording") {
        void useSttStore.getState().stopAndTranscribe();
      } else if (m === "dragging") {
        setDragging(false);
        if (latestPos) setBubblePos(latestPos);
      }
      // mode === "pending" is a stray click → no-op
    };

    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const m = modeRef.current;
      modeRef.current = "idle";
      teardown();
      if (m === "recording") {
        useSttStore.getState().cancel();
      } else if (m === "dragging") {
        setDragging(false);
        // Don't persist a partial drag — keep whatever was last persisted.
      }
    };

    elem.addEventListener("pointermove", onMove);
    elem.addEventListener("pointerup", onUp);
    elem.addEventListener("pointercancel", onCancel);
  };

  const style = pos
    ? { left: pos.x, top: pos.y, right: "auto", bottom: "auto", transform: "none" }
    : undefined;

  const showCountdown =
    phase === "listening" && remainingMs > 0 && remainingMs <= COUNTDOWN_MS;
  const countdownDigit = Math.max(1, Math.ceil(remainingMs / 1000));

  return (
    <div
      ref={bubbleRef}
      className={`stt-bubble stt-bubble--${phase}${pos ? " stt-bubble--free" : ""}`}
      role="status"
      aria-live="polite"
      style={style}
      data-dragging={dragging ? "true" : undefined}
      onPointerDown={onPointerDown}
    >
      {phase === "idle" && (
        <span
          className="stt-mic-idle"
          aria-label={`Hold ${displayHotkey(hotkey)} to talk`}
        >
          <Icon name="mic" size={24} />
        </span>
      )}

      {phase === "listening" && (
        <>
          <span className="stt-mic-dot" aria-hidden="true" />
          <Waveform analyser={analyser} />
          {showCountdown && (
            <span
              className="stt-countdown"
              aria-label={`${countdownDigit} seconds remaining`}
            >
              {countdownDigit}
            </span>
          )}
        </>
      )}

      {phase === "transcribing" && (
        <>
          <span className="stt-spinner" aria-hidden="true" />
          <span className="stt-label">{message || "Transcribing…"}</span>
        </>
      )}

      {phase === "success" && (
        <>
          <span className="stt-check" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
          <span className="stt-label">{message}</span>
        </>
      )}

      {phase === "error" && (
        <>
          <span className="stt-warn" aria-hidden="true">
            <Icon name="alert-circle" size={14} />
          </span>
          <span className="stt-label stt-label--err">{message}</span>
          {message.includes("API key") && (
            <button
              type="button"
              className="stt-action"
              onClick={() => {
                dismiss();
                setView("settings");
              }}
            >
              Open Settings
            </button>
          )}
          <button
            type="button"
            className="stt-close"
            aria-label="Dismiss"
            onClick={dismiss}
          >
            <Icon name="x" size={12} />
          </button>
        </>
      )}
    </div>
  );
}
