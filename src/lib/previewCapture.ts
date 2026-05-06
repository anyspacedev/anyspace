import { getCurrentWindow } from "@tauri-apps/api/window";
import { screenshotCaptureWindowRegion, type ScreenshotResult } from "./tauri";

/**
 * Pure capture: maps the iframe's CSS rect into physical pixels relative to
 * the OS window's top-left, then calls the Rust screenshot command. The
 * Rust side captures the window's compositor surface (xcap Window API), so
 * this works whether Teamship is foreground, occluded, or on a different
 * desktop / Space — no setFocus dance, no race against the agent calling
 * preview_screenshot while the operator is in another app.
 *
 * Window-local coordinate math:
 *   - rect.left/top: CSS px from the WebView viewport's top-left
 *   - scale: device pixel ratio
 *   - chromeOffset = innerPosition - outerPosition: physical-px offset from
 *     the window's outer top-left (what xcap captures) to the WebView
 *     viewport's top-left. On macOS with titleBarStyle:"Overlay" this is 0;
 *     on traditional title bars it's (0, titlebarHeight).
 *
 * Returns the file path + dataUrl. Does NOT push into the clipboard stack —
 * callers (UI button vs. Code-Agent API) decide what to do with the result.
 *
 * Throws if the iframe has zero area or the OS denies screen capture.
 */
export async function capturePreviewIframeRaw(
  iframe: HTMLIFrameElement,
): Promise<ScreenshotResult> {
  const rect = iframe.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error("preview iframe is not visible");
  }
  const win = getCurrentWindow();
  const [scale, inner, outer] = await Promise.all([
    win.scaleFactor(),
    win.innerPosition(),
    win.outerPosition(),
  ]);
  const offsetX = inner.x - outer.x;
  const offsetY = inner.y - outer.y;
  const x = Math.round(offsetX + rect.left * scale);
  const y = Math.round(offsetY + rect.top * scale);
  const width = Math.round(rect.width * scale);
  const height = Math.round(rect.height * scale);
  return screenshotCaptureWindowRegion({ x, y, width, height });
}
