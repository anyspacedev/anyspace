import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePaneDragStore } from "../../stores/paneDragStore";
import type { Pane as PaneType, PaneKind } from "../../lib/types";
import { Terminal } from "../terminal/Terminal";
import { Editor } from "../editor/Editor";
import { PreviewPane } from "../preview/PreviewPane";
import { FileBrowser } from "../sidebar/FileBrowser";
import { MobilePane } from "../mobile/MobilePane";
import { BrowserPane } from "../browser/BrowserPane";
import { PaneHeader } from "./PaneHeader";
import { Icon, type IconName } from "../ui/Icon";
import { modKey } from "../../lib/shortcuts";

export function Pane({ pane, tabId }: { pane: PaneType; tabId: string }) {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const togglePaneSelection = useWorkspaceStore((s) => s.togglePaneSelection);
  const clearPaneSelection = useWorkspaceStore((s) => s.clearPaneSelection);
  const tab = useWorkspaceStore((s) => s.tabs.find((x) => x.id === tabId));
  const activePaneId = tab?.activePaneId;
  const selectedPaneIds = tab?.selectedPaneIds ?? [];
  const isActive = pane.id === activePaneId;
  const selectionIndex = selectedPaneIds.indexOf(pane.id);
  const isSelected = selectionIndex >= 0;
  const broadcastSize = selectedPaneIds.length;
  const dropZone = usePaneDragStore((s) =>
    s.targetPaneId === pane.id ? s.zone : null,
  );

  return (
    <div
      className={
        "pane" + (isActive ? " active" : "") + (isSelected ? " selected" : "")
      }
      data-pane-id={pane.id}
      onMouseDown={(e) => {
        if (e[modKey]) {
          e.preventDefault();
          togglePaneSelection(tabId, pane.id);
          return;
        }
        setActivePane(tabId, pane.id);
        if (selectedPaneIds.length) clearPaneSelection(tabId);
      }}
    >
      <PaneHeader
        pane={pane}
        tabId={tabId}
        selectionIndex={isSelected ? selectionIndex + 1 : null}
        broadcastSize={isActive && broadcastSize >= 2 ? broadcastSize : 0}
      />
      <div className="pane-body">
        <PaneBody kind={pane.kind} pane={pane} tabId={tabId} />
      </div>
      {dropZone && <div className={`pane-drop-hint zone-${dropZone}`} />}
    </div>
  );
}

function PaneBody({ kind, pane, tabId }: { kind: PaneKind; pane: PaneType; tabId: string }) {
  switch (kind) {
    case "terminal": {
      // SSH reconnect bumps sshAttempt → the terminal remounts so it spawns
      // a fresh ssh process. Scrollback from the dead session is discarded
      // (acceptable: the remote shell that produced it is gone anyway).
      const sshAttempt = (pane.payload?.sshAttempt as number | undefined) ?? 0;
      return <Terminal key={`t-${sshAttempt}`} pane={pane} tabId={tabId} />;
    }
    case "editor": return <Editor pane={pane} tabId={tabId} />;
    case "preview": return <PreviewPane pane={pane} tabId={tabId} />;
    case "filebrowser": return <FileBrowser pane={pane} tabId={tabId} />;
    case "mobile": return <MobilePane pane={pane} tabId={tabId} />;
    case "browser": return <BrowserPane pane={pane} tabId={tabId} />;
    case "empty":
    default:
      return <EmptyPane pane={pane} tabId={tabId} />;
  }
}

const QUICK_PICKS: Array<{ kind: PaneKind; label: string; icon: IconName; hint: string }> = [
  { kind: "terminal", label: "Terminal", icon: "terminal", hint: "Run a shell" },
  { kind: "editor", label: "Editor", icon: "file-edit", hint: "Edit code" },
  { kind: "preview", label: "Preview", icon: "globe", hint: "Live web preview" },
  // "browser" intentionally omitted from quick picks until the embedded
  // child WebView path works on Linux (see BrowserPane.tsx). The kind
  // remains in the PaneKind union so persisted panes still render.
  { kind: "filebrowser", label: "Files", icon: "folder-tree", hint: "Browse a folder" },
  { kind: "mobile", label: "Mobile", icon: "smartphone", hint: "Android / iOS device" },
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
