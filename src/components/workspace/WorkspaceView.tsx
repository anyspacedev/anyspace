import { useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { registerShortcut } from "../../lib/shortcuts";
import { PaneGrid } from "./PaneGrid";

export function WorkspaceView() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const splitPane = useWorkspaceStore((s) => s.splitPane);

  useEffect(() => {
    if (!tab) return;
    const split = (direction: "horizontal" | "vertical") => () => {
      const target = tab.activePaneId ?? Object.keys(tab.panes)[0];
      if (!target) return;
      splitPane(tab.id, target, direction);
    };
    const u1 = registerShortcut("splitPane", split("horizontal"));
    const u2 = registerShortcut("splitPaneVertical", split("vertical"));
    return () => { u1(); u2(); };
  }, [tab, splitPane]);

  if (!tab) {
    return <div className="empty-view">No workspace</div>;
  }

  return (
    <div className="workspace">
      <PaneGrid key={tab.id} tab={tab} />
    </div>
  );
}
