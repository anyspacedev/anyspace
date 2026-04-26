import { useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Pane as PaneType, PaneKind } from "../../lib/types";
import { Terminal } from "../terminal/Terminal";
import { Editor } from "../editor/Editor";
import { PreviewPane } from "../preview/PreviewPane";
import { FileBrowser } from "../sidebar/FileBrowser";
import { PaneHeader } from "./PaneHeader";
import { Icon, type IconName } from "../ui/Icon";

type DropZone = "swap" | "top" | "right" | "bottom" | "left";

function detectDropZone(rect: DOMRect, clientX: number, clientY: number): DropZone {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const EDGE = 0.25;
  const dl = x;
  const dr = 1 - x;
  const dt = y;
  const db = 1 - y;
  const minD = Math.min(dl, dr, dt, db);
  if (minD > EDGE) return "swap";
  if (minD === dl) return "left";
  if (minD === dr) return "right";
  if (minD === dt) return "top";
  return "bottom";
}

export function Pane({ pane, tabId }: { pane: PaneType; tabId: string }) {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const swapPanes = useWorkspaceStore((s) => s.swapPanes);
  const movePaneToEdge = useWorkspaceStore((s) => s.movePaneToEdge);
  const activePaneId = useWorkspaceStore((s) => {
    const t = s.tabs.find((x) => x.id === tabId);
    return t?.activePaneId;
  });
  const isActive = pane.id === activePaneId;
  const [dropZone, setDropZone] = useState<DropZone | null>(null);

  return (
    <div
      className={"pane" + (isActive ? " active" : "")}
      onMouseDown={() => setActivePane(tabId, pane.id)}
      onDragOver={(e) => {
        const sourceId = document.body.dataset.dragPaneId;
        const sourceTab = document.body.dataset.dragTabId;
        if (!sourceId || sourceTab !== tabId || sourceId === pane.id) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        const zone = detectDropZone(
          e.currentTarget.getBoundingClientRect(),
          e.clientX,
          e.clientY,
        );
        setDropZone((prev) => (prev === zone ? prev : zone));
      }}
      onDragLeave={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && e.currentTarget.contains(next)) return;
        setDropZone(null);
      }}
      onDrop={(e) => {
        const sourceId = document.body.dataset.dragPaneId;
        const sourceTab = document.body.dataset.dragTabId;
        const zone = dropZone;
        setDropZone(null);
        if (!sourceId || sourceTab !== tabId || sourceId === pane.id) return;
        e.preventDefault();
        if (!zone || zone === "swap") {
          swapPanes(tabId, sourceId, pane.id);
        } else {
          movePaneToEdge(tabId, sourceId, pane.id, zone);
        }
      }}
    >
      <PaneHeader pane={pane} tabId={tabId} />
      <div className="pane-body">
        <PaneBody kind={pane.kind} pane={pane} tabId={tabId} />
      </div>
      {dropZone && <div className={`pane-drop-hint zone-${dropZone}`} />}
    </div>
  );
}

function PaneBody({ kind, pane, tabId }: { kind: PaneKind; pane: PaneType; tabId: string }) {
  switch (kind) {
    case "terminal": return <Terminal pane={pane} tabId={tabId} />;
    case "editor": return <Editor pane={pane} tabId={tabId} />;
    case "preview": return <PreviewPane pane={pane} tabId={tabId} />;
    case "filebrowser": return <FileBrowser pane={pane} tabId={tabId} />;
    case "empty":
    default:
      return <EmptyPane pane={pane} tabId={tabId} />;
  }
}

const QUICK_PICKS: Array<{ kind: PaneKind; label: string; icon: IconName; hint: string }> = [
  { kind: "terminal", label: "Terminal", icon: "terminal", hint: "Run a shell" },
  { kind: "editor", label: "Editor", icon: "file-edit", hint: "Edit code" },
  { kind: "preview", label: "Preview", icon: "globe", hint: "Live web preview" },
  { kind: "filebrowser", label: "Files", icon: "folder-tree", hint: "Browse a folder" },
];

function EmptyPane({ pane, tabId }: { pane: PaneType; tabId: string }) {
  const setPaneKind = useWorkspaceStore((s) => s.setPaneKind);
  return (
    <div className="empty-pane">
      <div className="empty-pane-card">
        <div className="empty-pane-title">Choose a pane kind</div>
        <div className="empty-pane-grid">
          {QUICK_PICKS.map((p) => (
            <button
              key={p.kind}
              className="empty-pane-pick"
              onClick={() => setPaneKind(tabId, pane.id, p.kind, {})}
            >
              <span className="empty-pane-pick-icon">
                <Icon name={p.icon} size={18} />
              </span>
              <span className="empty-pane-pick-label">{p.label}</span>
              <span className="empty-pane-pick-hint">{p.hint}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
