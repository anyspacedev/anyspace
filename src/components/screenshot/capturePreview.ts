import { getCurrentWindow } from "@tauri-apps/api/window";
import { screenshotCaptureRegion } from "../../lib/tauri";
import { useScreenshotStore } from "../../stores/screenshotStore";

// Captures the visible portion of the preview <iframe> via OS-level screen
// capture (xcap on the Rust side). The iframe is cross-origin, so reading its
// pixels directly from the parent webview isn't possible — we map the iframe's
// CSS bounding box into screen-physical pixels and capture that rectangle.
//
// Risks the math accounts for:
//   - The Tauri window's outerPosition() is in physical pixels.
//   - getBoundingClientRect() is in CSS pixels (post any DeviceFrame transform).
//   - On macOS titleBarStyle "Overlay" reserves a strip at the window top —
//     bridging that to client coords needs `outerSize - innerSize`. Linux and
//     Windows native frames don't have this offset; outerSize == innerSize +
//     decorations and we just use innerPosition() instead which is post-frame.
//
// To keep the logic platform-portable we use innerPosition() (the client-area
// origin in physical pixels) — Tauri exposes it on all platforms.
export async function capturePreviewIframe(iframe: HTMLIFrameElement): Promise<void> {
  const rect = iframe.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    console.warn("[screenshot] preview iframe is not visible");
    return;
  }

  const win = getCurrentWindow();

  // Bring the window to the foreground so another app's window doesn't end up
  // captured instead — xcap reads the screen, not the webview contents.
  try {
    await win.setFocus();
  } catch {
    /* setFocus is best-effort */
  }
  // Wait two paints so the focus + any decoration redraw lands before capture.
  await new Promise<void>((r) =>
    requestAnimationFrame(() => requestAnimationFrame(() => r())),
  );

  let scale = 1;
  let originX = 0;
  let originY = 0;
  try {
    scale = await win.scaleFactor();
    const inner = await win.innerPosition();
    originX = inner.x;
    originY = inner.y;
  } catch (e) {
    console.warn("[screenshot] could not read window position/scale:", e);
    return;
  }

  const x = Math.round(originX + rect.left * scale);
  const y = Math.round(originY + rect.top * scale);
  const width = Math.round(rect.width * scale);
  const height = Math.round(rect.height * scale);

  try {
    const result = await screenshotCaptureRegion({ x, y, width, height });
    useScreenshotStore
      .getState()
      .push({ path: result.path, dataUrl: result.dataUrl, source: "preview" });
  } catch (e) {
    const msg = String(e);
    const setNotice = useScreenshotStore.getState().setNotice;
    if (msg.includes("permission-denied")) {
      setNotice({
        kind: "error",
        message:
          "Screen capture blocked. Grant Screen Recording permission in System Settings, then try again.",
      });
    } else if (msg.includes("region-out-of-bounds")) {
      setNotice({
        kind: "error",
        message: "Preview is off-screen — scroll or resize so the iframe is visible.",
      });
    } else {
      setNotice({ kind: "error", message: `Couldn't capture preview: ${msg}` });
    }
    console.warn("[screenshot] preview capture failed:", e);
  }
}
