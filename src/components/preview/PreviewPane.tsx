import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import {
  previewCanFrame,
  previewDetect,
  previewWatchStart,
  previewWatchStop,
  type FrameabilityReason,
  type PreviewReloadEvent,
} from "../../lib/tauri";
import type { Pane } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { PreviewToolbar, type Device } from "./PreviewToolbar";
import { DeviceFrame } from "./DeviceFrame";
import { Icon } from "../ui/Icon";

type Props = { pane: Pane; tabId: string };

type LoadState =
  | { kind: "idle" }
  | { kind: "loading"; since: number }
  | { kind: "loaded"; at: number }
  | { kind: "error"; reason: FrameabilityReason; status: number | null };

const LOAD_TIMEOUT_MS = 8000;
const DETECT_POLL_MS = 1000;
const DETECT_TIMEOUT_MS = 20000;

function normalizeUrl(input: string): string | null {
  const v = input.trim();
  if (!v) return null;
  if (v.startsWith("file://")) return null;
  if (/^https?:\/\//i.test(v)) return v;
  // Bare host or host:port → assume http.
  if (/^[a-z0-9.-]+(:\d+)?(\/.*)?$/i.test(v)) return `http://${v}`;
  return null;
}

export function PreviewPane({ pane, tabId }: Props) {
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const url = pane.payload?.url as string | undefined;
  const projectPath = pane.payload?.projectPath as string | undefined;
  const device: Device = (pane.payload?.device as Device) ?? "desktop";
  const zoom: number = (pane.payload?.zoom as number) ?? 1;

  const [reloadTick, setReloadTick] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [framework, setFramework] = useState<string>("");
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });

  // Auto-detect dev server when projectPath is set without url. Polls until something answers
  // or the overall window expires — handles the cold-start race where the user picks a folder
  // before `npm run dev` has bound a port.
  useEffect(() => {
    if (!projectPath || url) return;
    let cancelled = false;
    setDetecting(true);
    const startedAt = Date.now();

    const tick = async () => {
      if (cancelled) return;
      try {
        const det = await previewDetect(projectPath);
        if (cancelled) return;
        if (det) {
          setPanePayload(tabId, pane.id, { url: det.url });
          setFramework(det.framework);
          setDetecting(false);
          return;
        }
      } catch {
        /* keep polling */
      }
      if (Date.now() - startedAt >= DETECT_TIMEOUT_MS) {
        if (!cancelled) setDetecting(false);
        return;
      }
      window.setTimeout(tick, DETECT_POLL_MS);
    };

    void tick();
    return () => {
      cancelled = true;
      setDetecting(false);
    };
  }, [projectPath, url, pane.id, tabId, setPanePayload]);

  // Start watcher for hot-reload, listen for classified reload events.
  useEffect(() => {
    if (!projectPath) return;
    let unlisten: (() => void) | null = null;
    void previewWatchStart(pane.id, projectPath).catch(() => {});
    void listen<PreviewReloadEvent>(`preview:reload:${pane.id}`, (ev) => {
      // Only force a hard reload for files the dev server's HMR can't handle.
      // Source-file edits arrive as "soft" — we leave them to the dev server's own HMR.
      if (ev.payload?.kind === "hard") {
        setReloadTick((t) => t + 1);
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      void previewWatchStop(pane.id).catch(() => {});
      if (unlisten) unlisten();
    };
  }, [projectPath, pane.id]);

  // The iframe loads in parallel; the probe runs alongside it and only flips us into the error
  // state when it can prove the URL is unreachable or refuses framing. If the iframe finishes
  // loading first (success path), it transitions us to "loaded" via onLoad. If the probe finds
  // a framing rejection first, the iframe's eventual onLoad is ignored.
  useEffect(() => {
    if (!url) {
      setLoad({ kind: "idle" });
      return;
    }
    let cancelled = false;
    setLoad({ kind: "loading", since: Date.now() });
    void previewCanFrame(url)
      .then((report) => {
        if (cancelled) return;
        if (!report.reachable) {
          setLoad({ kind: "error", reason: "unreachable", status: null });
        } else if (!report.framable) {
          setLoad({ kind: "error", reason: report.reason, status: report.status });
        }
      })
      .catch(() => {
        if (!cancelled) setLoad({ kind: "error", reason: "unreachable", status: null });
      });
    return () => {
      cancelled = true;
    };
  }, [url, reloadTick]);

  // Watchdog: if the iframe never fires `load`, fail open after a window. The frameability
  // probe should already have caught most cross-origin refusals, but mixed-content or sandboxed
  // redirects can only manifest at load time.
  useEffect(() => {
    if (load.kind !== "loading") return;
    const handle = window.setTimeout(() => {
      setLoad((cur) =>
        cur.kind === "loading" ? { kind: "error", reason: "unreachable", status: null } : cur,
      );
    }, LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(handle);
  }, [load.kind]);

  const pickProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setPanePayload(tabId, pane.id, { projectPath: selected, url: undefined });
    }
  };

  const setUrl = (raw: string) => {
    const normalized = normalizeUrl(raw);
    if (!normalized) return;
    setPanePayload(tabId, pane.id, { url: normalized });
  };
  const setDevice = (d: Device) => setPanePayload(tabId, pane.id, { device: d });
  const setZoom = (z: number) => setPanePayload(tabId, pane.id, { zoom: z });

  const onIframeLoad = () => {
    setLoad((cur) => (cur.kind === "loading" ? { kind: "loaded", at: Date.now() } : cur));
  };

  if (!url) {
    return (
      <div className="preview-empty">
        <div className="preview-empty-icon">
          <Icon name="globe" size={24} />
        </div>
        <div className="preview-empty-title">Live preview</div>
        <div className="preview-empty-sub">
          Auto-detects local dev servers (Vite, Next, Astro, SvelteKit, …) and reloads on file changes.
        </div>
        {detecting && (
          <div className="preview-empty-detecting">
            <span className="watching-dot" />
            <span>Probing localhost ports…</span>
          </div>
        )}
        <div className="preview-empty-actions">
          <button className="btn btn-primary btn-with-icon" onClick={pickProject}>
            <Icon name="folder" size={14} />
            <span>Pick project folder</span>
          </button>
        </div>
        <div className="preview-empty-divider"><span>or paste a URL</span></div>
        <input
          placeholder="http://localhost:5173"
          className="url-input preview-empty-url"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setUrl((e.target as HTMLInputElement).value);
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className="preview-pane">
      <PreviewToolbar
        url={url}
        device={device}
        zoom={zoom}
        framework={framework}
        onUrl={setUrl}
        onDevice={setDevice}
        onZoom={setZoom}
        onRefresh={() => setReloadTick((t) => t + 1)}
        onOpenExternal={() => void openExternal(url)}
        onPickProject={pickProject}
        watching={Boolean(projectPath)}
        loadStatus={load.kind}
        loadedAt={load.kind === "loaded" ? load.at : null}
      />
      <div className="preview-stage scrollbar">
        <DeviceFrame device={device} zoom={zoom}>
          <div className="preview-iframe-wrap">
            <iframe
              key={`${url}:${reloadTick}`}
              src={url}
              onLoad={onIframeLoad}
              className="preview-iframe"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              allow="accelerometer; camera; geolocation; gyroscope; microphone; clipboard-read; clipboard-write"
            />
            <PreviewOverlay
              load={load}
              url={url}
              onOpenExternal={() => void openExternal(url)}
              onRetry={() => setReloadTick((t) => t + 1)}
            />
          </div>
        </DeviceFrame>
      </div>
    </div>
  );
}

function PreviewOverlay({
  load,
  url,
  onOpenExternal,
  onRetry,
}: {
  load: LoadState;
  url: string;
  onOpenExternal: () => void;
  onRetry: () => void;
}) {
  const message = useMemo(() => describeLoad(load, url), [load, url]);
  if (!message) return null;
  return (
    <div className={`preview-overlay preview-overlay-${load.kind}`} role="status">
      {load.kind === "loading" ? (
        <span className="preview-spinner" aria-hidden />
      ) : (
        <Icon name="alert-circle" size={18} />
      )}
      <div className="preview-overlay-msg">
        <div className="preview-overlay-title">{message.title}</div>
        {message.body && <div className="preview-overlay-body">{message.body}</div>}
      </div>
      {load.kind === "error" && (
        <div className="preview-overlay-actions">
          <button className="btn btn-ghost btn-sm" onClick={onRetry}>Retry</button>
          <button className="btn btn-primary btn-sm btn-with-icon" onClick={onOpenExternal}>
            <Icon name="external-link" size={12} />
            <span>Open externally</span>
          </button>
        </div>
      )}
    </div>
  );
}

function describeLoad(
  load: LoadState,
  url: string,
): { title: string; body?: string } | null {
  switch (load.kind) {
    case "idle":
    case "loaded":
      return null;
    case "loading":
      return { title: "Loading preview…", body: url };
    case "error":
      switch (load.reason) {
        case "x-frame-options":
          return {
            title: "This site refuses to be framed",
            body: "X-Frame-Options blocks embedding. Open it in your system browser to view.",
          };
        case "csp-frame-ancestors":
          return {
            title: "This site refuses to be framed",
            body: "Content-Security-Policy frame-ancestors blocks embedding.",
          };
        case "non-2xx":
          return {
            title: `Server returned ${load.status ?? "an error"}`,
            body: url,
          };
        case "unreachable":
        default:
          return {
            title: "Couldn't reach the page",
            body: `${url} didn't respond. Make sure the dev server is running.`,
          };
      }
  }
}
