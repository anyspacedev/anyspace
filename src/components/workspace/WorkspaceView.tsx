import { useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useNewWorkspacePickerStore } from "../../stores/newWorkspacePickerStore";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { useSuperAgentSettingsStore } from "../../stores/superAgentSettingsStore";
import { registerShortcut } from "../../lib/shortcuts";
import { PaneGrid } from "./PaneGrid";
import { SuperAgentPanel } from "../superAgent/SuperAgentPanel";
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
  const openPickerWith = useNewWorkspacePickerStore((s) => s.openWith);
  const superAgentOpen = useSuperAgentStore((s) => s.panelOpen);
  const setSuperAgentOpen = useSuperAgentStore((s) => s.setPanelOpen);
  const superAgentWidth = useSuperAgentSettingsStore((s) => s.settings.panelWidth);

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

  if (tabs.length === 0) {
    return (
      <>
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
            <h1 className="welcome-title">Welcome aboard</h1>
            <div className="welcome-sub">
              Open a terminal to get started, or browse your task board.
            </div>
            <div className="welcome-actions">
              <button
                className="btn btn-primary btn-with-icon"
                onClick={() => newTab(1)}
              >
                <Icon name="terminal" size={14} />
                <span>Open Terminal</span>
              </button>
              <button
                className="btn btn-with-icon"
                onClick={() => openPickerWith("team")}
              >
                <Icon name="users-round" size={14} />
                <span>Start team</span>
              </button>
            </div>
            <button
              type="button"
              className="welcome-tertiary"
              onClick={() => setView("kanban")}
            >
              or browse your task board →
            </button>
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
      </>
    );
  }

  const cls = ["workspace"];
  if (superAgentOpen) cls.push("has-super-agent");

  const cssVars: React.CSSProperties = {};
  if (superAgentOpen) (cssVars as Record<string, string>)["--super-agent-w"] = `${superAgentWidth}px`;

  return (
    <div className={cls.join(" ")} style={cssVars}>
      <div className="workspace-content">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={"workspace-tab" + (t.id === activeTabId ? " active" : "")}
            aria-hidden={t.id !== activeTabId}
          >
            <PaneGrid tab={t} />
          </div>
        ))}
        {!superAgentOpen && (
          <button
            type="button"
            className="sa-collapsed-tab"
            onClick={() => setSuperAgentOpen(true)}
            aria-label="Open Super Agent"
            title="Open Super Agent"
          >
            <Icon name="sparkles" size={14} />
          </button>
        )}
      </div>
      {superAgentOpen && <SuperAgentPanel />}
    </div>
  );
}
