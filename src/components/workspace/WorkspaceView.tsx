import { useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { registerShortcut } from "../../lib/shortcuts";
import { PaneGrid } from "./PaneGrid";
import { useThemeStore } from "../../stores/themeStore";
import { Icon } from "../ui/Icon";

export function WorkspaceView() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const splitPane = useWorkspaceStore((s) => s.splitPane);
  const newTab = useWorkspaceStore((s) => s.newTab);
  const setView = useWorkspaceStore((s) => s.setView);
  const theme = useThemeStore((s) => s.current);

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
    return (
      <div className="welcome">
        <div className="welcome-card">
          <div
            className="welcome-mark"
            style={{
              background: `linear-gradient(135deg, ${theme.ui.accent}, ${theme.ui.info})`,
              color: theme.ui.accentFg,
            }}
          >
            T
          </div>
          <div className="welcome-title">Welcome to Teamship</div>
          <div className="welcome-sub">
            A multi-pane terminal multiplexer with command blocks,
            an editor, live preview, and a Kanban-driven AI agent launcher.
          </div>
          <div className="welcome-actions">
            <button
              className="btn btn-primary btn-with-icon"
              onClick={() => newTab(1)}
            >
              <Icon name="plus" size={14} />
              <span>New workspace</span>
            </button>
            <button
              className="btn btn-with-icon"
              onClick={() => setView("kanban")}
            >
              <Icon name="list-checks" size={14} />
              <span>Browse tasks</span>
            </button>
          </div>
          <div className="welcome-hints">
            <div className="welcome-hint">
              <kbd>⌘T</kbd>
              <span>New workspace</span>
            </div>
            <div className="welcome-hint">
              <kbd>⌘P</kbd>
              <span>Quick open file</span>
            </div>
            <div className="welcome-hint">
              <kbd>⌘D</kbd>
              <span>Split pane</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace">
      <PaneGrid key={tab.id} tab={tab} />
    </div>
  );
}
