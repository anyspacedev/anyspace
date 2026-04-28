import { screenshotSavePngBytes } from "../../lib/tauri";
import { useScreenshotStore } from "../../stores/screenshotStore";

// Captures the current frame painted on the mobile pane's <canvas> (Android
// scrcpy or iOS ScreenCaptureKit) as PNG, persists it under
// /tmp/teamship-screenshots/, and pushes a thumbnail into the floating stack.
export async function captureMobileCanvas(canvas: HTMLCanvasElement): Promise<void> {
  if (!canvas.width || !canvas.height) {
    console.warn("[screenshot] mobile canvas has no frame yet");
    return;
  }

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png"),
  );

  const store = useScreenshotStore.getState();

  // toBlob returning null on a healthy canvas is rare but real on WKWebView when
  // the most recent paint came from a now-closed VideoFrame. Fall back to the
  // synchronous data-URL path which doesn't share that pitfall.
  if (!blob) {
    const dataUrl = canvas.toDataURL("image/png");
    const bytes = dataUrlToBytes(dataUrl);
    if (!bytes) {
      store.setNotice({ kind: "error", message: "Couldn't read the device frame." });
      return;
    }
    try {
      const path = await screenshotSavePngBytes(bytes);
      store.push({ path, dataUrl, source: "mobile" });
    } catch (e) {
      store.setNotice({ kind: "error", message: `Couldn't save screenshot: ${String(e)}` });
    }
    return;
  }

  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const path = await screenshotSavePngBytes(bytes);
    const dataUrl = canvas.toDataURL("image/png");
    store.push({ path, dataUrl, source: "mobile" });
  } catch (e) {
    store.setNotice({ kind: "error", message: `Couldn't save screenshot: ${String(e)}` });
  }
}

function dataUrlToBytes(dataUrl: string): Uint8Array | null {
  const i = dataUrl.indexOf(",");
  if (i < 0) return null;
  try {
    const bin = atob(dataUrl.slice(i + 1));
    const out = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) out[k] = bin.charCodeAt(k);
    return out;
  } catch {
    return null;
  }
}
