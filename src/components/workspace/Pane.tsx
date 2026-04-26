import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePaneDragStore } from "../../stores/paneDragStore";
import type { Pane as PaneType, PaneKind } from "../../lib/types";
import { Terminal } from "../terminal/Terminal";
import { Editor } from "../editor/Editor";
import { PreviewPane } from "../preview/PreviewPane";
import { FileBrowser } from "../sidebar/FileBrowser";
import { PaneHeader } from "./PaneHeader";
import { Icon, type IconName } from "../ui/Icon";

export function Pane({ pane, tabId }: { pane: PaneType; tabId: string }) {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const activePaneId = useWorkspaceStore((s) => {
    const t = s.tabs.find((x) => x.id === tabId);
    return t?.activePaneId;
  });
  const isActive = pane.id === activePaneId;
  const dropZone = usePaneDragStore((s) =>
    s.targetPaneId === pane.id ? s.zone : null,
  );

  return (
    <div
      className={"pane" + (isActive ? " active" : "")}
      data-pane-id={pane.id}
      onMouseDown={() => setActivePane(tabId, pane.id)}
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
