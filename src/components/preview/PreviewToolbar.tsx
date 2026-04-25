import { useEffect, useState } from "react";
import { Icon } from "../ui/Icon";

export type Device = "desktop" | "tablet" | "phone" | "fluid";

const DEVICES: Array<{ id: Device; label: string; w: number; h: number }> = [
  { id: "fluid", label: "Fluid", w: 0, h: 0 },
  { id: "desktop", label: "Desktop 1280", w: 1280, h: 800 },
  { id: "tablet", label: "Tablet 768", w: 768, h: 1024 },
  { id: "phone", label: "iPhone 15", w: 393, h: 852 },
];

export type LoadStatus = "idle" | "loading" | "loaded" | "error";

export function PreviewToolbar({
  url,
  device,
  zoom,
  framework,
  onUrl,
  onDevice,
  onZoom,
  onRefresh,
  onOpenExternal,
  onPickProject,
  watching,
  loadStatus,
  loadedAt,
}: {
  url: string;
  device: Device;
  zoom: number;
  framework: string;
  onUrl: (u: string) => void;
  onDevice: (d: Device) => void;
  onZoom: (z: number) => void;
  onRefresh: () => void;
  onOpenExternal: () => void;
  onPickProject: () => void;
  watching: boolean;
  loadStatus: LoadStatus;
  loadedAt: number | null;
}) {
  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);

  return (
    <div className="preview-toolbar">
      <button className="icon-btn" title="Refresh" aria-label="Refresh" onClick={onRefresh}>
        <Icon name="refresh" size={14} />
      </button>
      <div className={`url-input-wrap status-${loadStatus}`}>
        <span className="url-status-dot" aria-hidden />
        <input
          className="url-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onUrl(draft);
          }}
        />
      </div>
      <button
        className="icon-btn"
        title="Open in system browser"
        aria-label="Open in system browser"
        onClick={onOpenExternal}
      >
        <Icon name="external-link" size={14} />
      </button>
      <span className="toolbar-divider" />
      <select
        value={device}
        onChange={(e) => onDevice(e.target.value as Device)}
        className="device-select"
        title="Device frame"
      >
        {DEVICES.map((d) => (
          <option key={d.id} value={d.id}>{d.label}</option>
        ))}
      </select>
      <select
        value={zoom}
        onChange={(e) => onZoom(Number(e.target.value))}
        className="zoom-select"
        title="Zoom"
      >
        {[0.5, 0.75, 1, 1.25, 1.5, 2].map((z) => (
          <option key={z} value={z}>{Math.round(z * 100)}%</option>
        ))}
      </select>
      <span className="toolbar-divider" />
      <button className="btn btn-ghost" onClick={onPickProject} title="Watch a project folder">
        {watching ? "Change project" : "Watch folder"}
      </button>
      {framework && <span className="framework-tag">{framework}</span>}
      {loadedAt && <LastLoaded at={loadedAt} />}
      {watching && <span className="watching-dot" title="watching for file changes" />}
    </div>
  );
}

function LastLoaded({ at }: { at: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => force((n) => n + 1), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <span className="preview-last-loaded" title={new Date(at).toLocaleTimeString()}>
      {formatAgo(Date.now() - at)}
    </span>
  );
}

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}
