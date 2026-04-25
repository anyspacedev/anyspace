import { useEffect, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { previewDetect, previewWatchStart, previewWatchStop } from "../../lib/tauri";
import type { Pane } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { PreviewToolbar, type Device } from "./PreviewToolbar";
import { DeviceFrame } from "./DeviceFrame";

type Props = { pane: Pane; tabId: string };

export function PreviewPane({ pane, tabId }: Props) {
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const url = pane.payload?.url as string | undefined;
  const projectPath = pane.payload?.projectPath as string | undefined;
  const device: Device = (pane.payload?.device as Device) ?? "desktop";
  const zoom: number = (pane.payload?.zoom as number) ?? 1;

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [detecting, setDetecting] = useState(false);
  const [framework, setFramework] = useState<string>("");

  // Auto-detect dev server when projectPath is set without url.
  useEffect(() => {
    if (!projectPath || url) return;
    setDetecting(true);
    previewDetect(projectPath)
      .then((det) => {
        if (det) {
          setPanePayload(tabId, pane.id, { url: det.url });
          setFramework(det.framework);
        }
      })
      .finally(() => setDetecting(false));
  }, [projectPath, url, pane.id, tabId, setPanePayload]);

  // Start watcher for hot-reload, listen for reload events.
  useEffect(() => {
    if (!projectPath) return;
    let unlisten: (() => void) | null = null;
    void previewWatchStart(pane.id, projectPath).catch(() => {});
    void listen(`preview:reload:${pane.id}`, () => {
      setReloadTick((t) => t + 1);
    }).then((u) => { unlisten = u; });
    return () => {
      void previewWatchStop(pane.id).catch(() => {});
      if (unlisten) unlisten();
    };
  }, [projectPath, pane.id]);

  // Apply reload tick by re-setting iframe src.
  useEffect(() => {
    if (!iframeRef.current || !url) return;
    iframeRef.current.src = url;
  }, [reloadTick, url]);

  const pickProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setPanePayload(tabId, pane.id, { projectPath: selected, url: undefined });
    }
  };

  const setUrl = (u: string) => setPanePayload(tabId, pane.id, { url: u });
  const setDevice = (d: Device) => setPanePayload(tabId, pane.id, { device: d });
  const setZoom = (z: number) => setPanePayload(tabId, pane.id, { zoom: z });

  if (!url) {
    return (
      <div className="preview-empty">
        <div className="preview-empty-title">Live preview</div>
        <div className="preview-empty-sub">
          Auto-detects local dev servers (Vite, Next, Astro, SvelteKit, …) and reloads on file changes.
        </div>
        {detecting && <div className="muted">Probing localhost ports…</div>}
        <div className="preview-empty-actions">
          <button className="btn" onClick={pickProject}>Pick project folder…</button>
          <span className="muted">or paste a URL:</span>
          <input
            placeholder="http://localhost:5173"
            className="url-input"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) setUrl(v);
              }
            }}
          />
        </div>
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
      />
      <div className="preview-stage scrollbar">
        <DeviceFrame device={device} zoom={zoom}>
          <iframe
            ref={iframeRef}
            key={url}
            src={url}
            className="preview-iframe"
            // Most localhost dev servers don't set X-Frame-Options.
            // For cross-origin previews, recommend native child webview (planned step 13).
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            allow="accelerometer; camera; geolocation; gyroscope; microphone; clipboard-read; clipboard-write"
          />
        </DeviceFrame>
      </div>
    </div>
  );
}
