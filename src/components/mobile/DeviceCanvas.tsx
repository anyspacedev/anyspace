import { useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import type { Pane as PaneType } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  mobileConnect,
  mobileDisconnect,
  mobileInput,
  type MobileInputEvent,
  type MobileTarget,
} from "../../lib/mobile";
import { AnnexbDeframer, isKeyAU } from "../../lib/h264";
import { Icon } from "../ui/Icon";

// View + control DeviceCanvas. Owns:
//
//   - the video Channel<Uint8Array> from `mobile_connect`,
//   - the Annex-B deframer (bytes → access units),
//   - a WebCodecs VideoDecoder configured for H.264 baseline (avc1.42E01F),
//   - the canvas that decoded frames are drawn into,
//   - pointer + wheel handlers that dispatch through `mobile_input`.
//
// Keyboard typing arrives in a follow-up — touch is the critical path.

type Status = "connecting" | "streaming" | "error" | "no-codec";

const FRAME_STEP_US = Math.round(1_000_000 / 30);

// JS deltaY magnitudes vary wildly by input device and OS; rather than
// compute "real" intensity we just send the sign as a full ±1 tick. scrcpy
// scrolls in discrete steps anyway.
function normalizeWheelDelta(d: number): number {
  if (d === 0) return 0;
  return d > 0 ? -1 : 1; // browser sign is "down = positive", scrcpy "up = positive"
}

function canvasCoords(
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
  const x = ((clientX - rect.left) / rect.width) * canvas.width;
  const y = ((clientY - rect.top) / rect.height) * canvas.height;
  return { x: Math.round(x), y: Math.round(y) };
}

export function DeviceCanvas({ pane, tabId }: { pane: PaneType; tabId: string }) {
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const activePointersRef = useRef<Set<number>>(new Set());
  // Most recent in-canvas pointer position, in canvas pixel space. Used to
  // emit a sensible touch-up coordinate when the cursor has been warped
  // off-canvas by an iOS-side CGEvent injection (see onPointerMove).
  const lastValidPosRef = useRef<{ x: number; y: number } | null>(null);
  const [status, setStatus] = useState<Status>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [frameCount, setFrameCount] = useState(0);

  const target = pane.payload?.target as MobileTarget | undefined;
  const deviceId = pane.payload?.deviceId as string | undefined;
  const source = pane.payload?.source as "emulator" | "usb" | undefined;
  // The chooser stamps the device's display name onto `title` — reuse it
  // as the iOS helper's `--device-name` argument.
  const deviceName = pane.payload?.title as string | undefined;
  const showLogs = pane.payload?.showLogs !== false;

  useEffect(() => {
    if (!target || !deviceId || !source) {
      setError("Device not selected");
      setStatus("error");
      return;
    }

    let aborted = false;
    let connectionId: string | null = null;
    let decoder: VideoDecoder | null = null;
    const deframer = new AnnexbDeframer();
    let firstKeySent = false;
    let timestampUs = 0;

    const onVideo = new Channel<Uint8Array>();
    onVideo.onmessage = (chunk) => {
      if (aborted || !decoder) return;
      const buf = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayLike<number>);
      const aus = deframer.push(buf);
      for (const au of aus) {
        const key = isKeyAU(au);
        if (!firstKeySent && !key) continue;
        firstKeySent = true;
        try {
          decoder.decode(
            new EncodedVideoChunk({
              type: key ? "key" : "delta",
              timestamp: timestampUs,
              data: au,
            }),
          );
          timestampUs += FRAME_STEP_US;
        } catch (e) {
          setError(`decode failed: ${e instanceof Error ? e.message : String(e)}`);
          setStatus("error");
        }
      }
    };

    (async () => {
      if (typeof window.VideoDecoder !== "function") {
        setStatus("no-codec");
        setError("VideoDecoder API not available in this WebView build");
        return;
      }

      decoder = new VideoDecoder({
        output(frame) {
          const cv = canvasRef.current;
          if (!cv) {
            frame.close();
            return;
          }
          if (cv.width !== frame.displayWidth) cv.width = frame.displayWidth;
          if (cv.height !== frame.displayHeight) cv.height = frame.displayHeight;
          const ctx = cv.getContext("2d");
          if (ctx) ctx.drawImage(frame, 0, 0, cv.width, cv.height);
          frame.close();
          setFrameCount((n) => n + 1);
          if (!aborted) setStatus("streaming");
        },
        error(e) {
          if (aborted) return;
          setError(`decoder error: ${e.message}`);
          setStatus("error");
        },
      });

      try {
        decoder.configure({ codec: "avc1.42E01F", optimizeForLatency: true });
      } catch (e) {
        setError(`couldn't configure decoder: ${e instanceof Error ? e.message : String(e)}`);
        setStatus("error");
        return;
      }

      try {
        const conn = await mobileConnect(
          { paneId: pane.id, target, deviceId, source, deviceName },
          onVideo,
        );
        if (aborted) {
          await mobileDisconnect(conn.connectionId).catch(() => {});
          return;
        }
        connectionId = conn.connectionId;
        connectionIdRef.current = connectionId;
        setPanePayload(tabId, pane.id, { connectionId });
      } catch (e) {
        if (aborted) return;
        setError(String(e));
        setStatus("error");
      }
    })();

    return () => {
      aborted = true;
      try {
        decoder?.close();
      } catch {
        /* decoder may already be closed */
      }
      connectionIdRef.current = null;
      activePointersRef.current.clear();
      if (connectionId) {
        void mobileDisconnect(connectionId).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane.id, target, deviceId, source, deviceName]);

  const sendInput = (event: MobileInputEvent) => {
    const id = connectionIdRef.current;
    if (!id) return;
    void mobileInput(id, event).catch(() => {});
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv || !cv.width || !cv.height) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    activePointersRef.current.add(e.pointerId);
    const { x, y } = canvasCoords(cv, e.clientX, e.clientY);
    lastValidPosRef.current = { x, y };
    sendInput({
      kind: "touch",
      action: "down",
      x,
      y,
      pointerId: e.pointerId,
      screenWidth: cv.width,
      screenHeight: cv.height,
    });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activePointersRef.current.has(e.pointerId)) return;
    const cv = canvasRef.current;
    if (!cv || !cv.width || !cv.height) return;
    // Pointer capture keeps the canvas receiving pointermove even when the
    // OS cursor is outside it. On iOS, our CGEvent injection on the helper
    // side warps the OS cursor into the Simulator window — the browser then
    // fires a "phantom" pointermove with wildly out-of-canvas clientX/Y.
    // If we forwarded those, the helper would warp the cursor again, the
    // browser would fire another phantom, and so on (runaway loop seen in
    // [iossimstream] logs as canvas(-4851,1985) etc.). Skip any pointermove
    // whose cursor is outside the canvas's CSS bounds — that's the only
    // way a phantom event can arrive while our finger is still down.
    const rect = cv.getBoundingClientRect();
    if (
      e.clientX < rect.left || e.clientX > rect.right ||
      e.clientY < rect.top || e.clientY > rect.bottom
    ) {
      return;
    }
    const { x, y } = canvasCoords(cv, e.clientX, e.clientY);
    lastValidPosRef.current = { x, y };
    sendInput({
      kind: "touch",
      action: "move",
      x,
      y,
      pointerId: e.pointerId,
      screenWidth: cv.width,
      screenHeight: cv.height,
    });
  };

  const onPointerEnd = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!activePointersRef.current.delete(e.pointerId)) return;
    const cv = canvasRef.current;
    if (!cv || !cv.width || !cv.height) return;
    if (cv.hasPointerCapture(e.pointerId)) cv.releasePointerCapture(e.pointerId);
    // Use the last in-canvas position rather than e.clientX/Y — the cursor
    // has likely been warped outside the canvas by our own injection by
    // the time pointerup fires, so trusting clientX/Y here would emit an
    // out-of-bounds touch-up that drops the simulator into a confused state.
    const pos = lastValidPosRef.current ?? canvasCoords(cv, e.clientX, e.clientY);
    lastValidPosRef.current = null;
    sendInput({
      kind: "touch",
      action: "up",
      x: pos.x,
      y: pos.y,
      pointerId: e.pointerId,
      screenWidth: cv.width,
      screenHeight: cv.height,
    });
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const cv = canvasRef.current;
    if (!cv || !cv.width || !cv.height) return;
    e.preventDefault();
    const { x, y } = canvasCoords(cv, e.clientX, e.clientY);
    sendInput({
      kind: "scroll",
      x,
      y,
      screenWidth: cv.width,
      screenHeight: cv.height,
      dx: normalizeWheelDelta(e.deltaX),
      dy: normalizeWheelDelta(e.deltaY),
    });
  };

  const onDisconnect = () => {
    setPanePayload(tabId, pane.id, {
      connectionId: undefined,
      deviceId: undefined,
      target: undefined,
      source: undefined,
      title: undefined,
    });
  };

  const onToggleLogs = () => {
    setPanePayload(tabId, pane.id, { showLogs: !showLogs });
  };

  const overlayVisible = status !== "streaming";
  const inputDisabled = status !== "streaming";

  return (
    <div className="mobile-stream">
      <div className="mobile-stream-toolbar">
        <span className={"mobile-stream-status status-" + status}>
          {status === "connecting" && "Connecting…"}
          {status === "streaming" && `Streaming · ${frameCount} frames`}
          {status === "error" && "Error"}
          {status === "no-codec" && "WebCodecs unavailable"}
        </span>
        <div className="mobile-stream-nav">
          <button
            className="icon-btn"
            title="Back"
            aria-label="Back"
            disabled={inputDisabled}
            onClick={() => sendInput({ kind: "back" })}
          >
            <Icon name="chevron-left" size={14} />
          </button>
          <button
            className="icon-btn"
            title="Home"
            aria-label="Home"
            disabled={inputDisabled}
            onClick={() => sendInput({ kind: "home" })}
          >
            <Icon name="circle" size={12} />
          </button>
          <button
            className="icon-btn"
            title="Recent apps"
            aria-label="Recent apps"
            disabled={inputDisabled}
            onClick={() => sendInput({ kind: "appSwitch" })}
          >
            <Icon name="square-dashed" size={14} />
          </button>
        </div>
        <button
          className={"icon-btn" + (showLogs ? " toggled-on" : "")}
          title={showLogs ? "Hide logs" : "Show logs"}
          aria-label="Toggle logs"
          onClick={onToggleLogs}
        >
          <Icon name="terminal" size={14} />
        </button>
        <button
          className="icon-btn mobile-stream-disconnect"
          onClick={onDisconnect}
          title="Disconnect"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="mobile-stream-viewport">
        <canvas
          ref={canvasRef}
          className="mobile-stream-canvas"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onPointerLeave={onPointerEnd}
          onWheel={onWheel}
          // touch-action: none disables browser pinch/pan/zoom gestures so
          // multi-touch reaches our pointer handlers cleanly. CSS handles
          // it but setting here too for older WebKit builds.
          style={{ touchAction: "none" }}
        />
        {overlayVisible && (
          <div className={"mobile-stream-overlay overlay-" + status}>
            <Icon
              name={status === "error" || status === "no-codec" ? "alert-circle" : "smartphone"}
              size={28}
            />
            <div className="mobile-stream-overlay-title">
              {status === "connecting"
                ? "Connecting to device…"
                : status === "no-codec"
                  ? "WebCodecs unavailable"
                  : "Connection failed"}
            </div>
            {error && <div className="mobile-stream-overlay-msg">{error}</div>}
          </div>
        )}
      </div>
    </div>
  );
}
