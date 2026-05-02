import { useEffect, useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTeamStore } from "../../stores/teamStore";
import { registerShortcut } from "../../lib/shortcuts";
import { PaneGrid } from "./PaneGrid";
import { TeamChatPanel } from "../team/TeamChatPanel";
import { TeamPickerModal } from "./TeamPicker";
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
  const teams = useTeamStore((s) => s.teams);
  const teamForActive = teams.find((t) => t.tabId === activeTabId);
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);

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

  // The picker stays mounted across the welcome→workspace transition so
  // launchTeam (which adds a tab mid-flight, flipping the conditional) can
  // finish without the modal unmounting underneath it.
  const modal = (
    <TeamPickerModal open={teamPickerOpen} onClose={() => setTeamPickerOpen(false)} />
  );

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
            <div className="welcome-title">Welcome aboard</div>
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
                onClick={() => setTeamPickerOpen(true)}
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
        {modal}
      </>
    );
  }

  return (
    <>
      <div className={"workspace" + (teamForActive ? " has-team-chat" : "")}>
        {tabs.map((t) => (
          <div
            key={t.id}
            className={"workspace-tab" + (t.id === activeTabId ? " active" : "")}
            aria-hidden={t.id !== activeTabId}
          >
            <PaneGrid tab={t} />
          </div>
        ))}
        {teamForActive && activeTabId && <TeamChatPanel tabId={activeTabId} />}
      </div>
      {modal}
    </>
  );
}
