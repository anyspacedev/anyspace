import { capturePreviewIframeRaw } from "../../lib/previewCapture";
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
  try {
    const result = await capturePreviewIframeRaw(iframe);
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
    } else if (msg.includes("not visible")) {
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
