import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Pane as PaneType, PaneKind } from "../../lib/types";
import { Terminal } from "../terminal/Terminal";
import { Editor } from "../editor/Editor";
import { PreviewPane } from "../preview/PreviewPane";
import { FileBrowser } from "../sidebar/FileBrowser";
import { PaneHeader } from "./PaneHeader";

export function Pane({ pane, tabId }: { pane: PaneType; tabId: string }) {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const activePaneId = useWorkspaceStore((s) => {
    const t = s.tabs.find((x) => x.id === tabId);
    return t?.activePaneId;
  });
  const isActive = pane.id === activePaneId;

  return (
    <div
      className={"pane" + (isActive ? " active" : "")}
      onMouseDown={() => setActivePane(tabId, pane.id)}
    >
      <PaneHeader pane={pane} tabId={tabId} />
      <div className="pane-body">
        <PaneBody kind={pane.kind} pane={pane} tabId={tabId} />
      </div>
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
      return <div className="empty-pane">Empty pane</div>;
  }
}
