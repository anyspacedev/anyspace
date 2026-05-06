// Iframe driver for the Code-Agent preview API. Owns three things:
//  1. paneId → iframe-ref map (PreviewPane.tsx registers itself on mount)
//  2. A pending-response map keyed by per-drive uuid
//  3. A single window-level "message" listener that dispatches drive:result
//     replies from any of our registered preview iframes. The picker_script
//     posts {src:"teamship", type:"drive:result", reqId, ok, ...} back via
//     window.parent.postMessage.

const refs = new Map<string, HTMLIFrameElement>();
const pending = new Map<string, (result: unknown) => void>();

export function registerPreviewIframe(paneId: string, iframe: HTMLIFrameElement) {
  refs.set(paneId, iframe);
}

export function unregisterPreviewIframe(paneId: string) {
  refs.delete(paneId);
}

export function getPreviewIframe(paneId: string): HTMLIFrameElement | undefined {
  return refs.get(paneId);
}

let listenerInstalled = false;
function ensureListener() {
  if (listenerInstalled) return;
  listenerInstalled = true;
  window.addEventListener("message", (e) => {
    const msg = e.data as
      | { src?: string; type?: string; reqId?: string; ok?: boolean }
      | undefined;
    if (!msg || msg.src !== "teamship" || msg.type !== "drive:result") return;
    // Only accept messages whose source window is one of our registered iframes.
    const fromOurs = Array.from(refs.values()).some(
      (frame) => frame.contentWindow === e.source,
    );
    if (!fromOurs) return;
    const reqId = msg.reqId;
    if (!reqId) return;
    const cb = pending.get(reqId);
    if (cb) {
      pending.delete(reqId);
      cb(msg);
    }
  });
}

export async function driveIframe(
  paneId: string,
  type: "drive:click" | "drive:fill",
  payload: Record<string, unknown>,
  timeoutMs = 5000,
): Promise<unknown> {
  ensureListener();
  const ref = refs.get(paneId);
  if (!ref) throw new Error(`no preview iframe registered for pane ${paneId}`);
  const win = ref.contentWindow;
  if (!win) throw new Error(`preview iframe for pane ${paneId} has no contentWindow`);
  const reqId =
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  return new Promise<unknown>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(reqId);
      reject(new Error(`drive ${type} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    pending.set(reqId, (result) => {
      window.clearTimeout(timer);
      resolve(result);
    });
    win.postMessage({ src: "teamship", type, reqId, payload }, "*");
  });
}
