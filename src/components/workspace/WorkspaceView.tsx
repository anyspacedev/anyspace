import { useEffect } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { useSuperAgentSettingsStore } from "../../stores/superAgentSettingsStore";
import { registerShortcut } from "../../lib/shortcuts";
import { PaneGrid } from "./PaneGrid";
import { SuperAgentPanel } from "../superAgent/SuperAgentPanel";
import { Icon } from "../ui/Icon";
import { SetupChecklist } from "../onboarding/SetupChecklist";
import { DragCoachmark } from "./DragCoachmark";
import { SelectionTray } from "./SelectionTray";

export function WorkspaceView() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const splitPane = useWorkspaceStore((s) => s.splitPane);
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
    return <SetupChecklist />;
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
        <SelectionTray />
        <DragCoachmark />
      </div>
      {superAgentOpen && <SuperAgentPanel />}
    </div>
  );
}
