import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { TemplatePickerTrigger } from "./TemplatePicker";
import { TeamPickerTrigger } from "./TeamPicker";
import { Icon } from "../ui/Icon";

function pathBasename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "");
  const last = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return last || trimmed;
}

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const view = useWorkspaceStore((s) => s.selectedView);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const setTabProjectPath = useWorkspaceStore((s) => s.setTabProjectPath);
  const [editingId, setEditingId] = useState<string | null>(null);

  const pickWorkspaceFolder = async () => {
    if (!activeTab) return;
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: activeTab.projectPath,
      title: "Choose workspace folder",
    });
    if (typeof selected === "string") setTabProjectPath(activeTab.id, selected);
  };

  if (view !== "workspace") {
    return (
      <div className="tabbar">
        <div className="tabbar-title">
          {view === "kanban" && "Task Board"}
          {view === "agents" && "Agents"}
          {view === "teams" && "Teams"}
          {view === "settings" && "Settings"}
        </div>
      </div>
    );
  }

  return (
    <div className="tabbar">
      <div className="tabbar-tabs scrollbar">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className={"tab" + (tab.id === activeTabId ? " active" : "")}
            aria-current={tab.id === activeTabId ? "page" : undefined}
            onClick={() => setActiveTab(tab.id)}
            onDoubleClick={() => setEditingId(tab.id)}
          >
            <span className="tab-color" style={{ background: tab.color }} />
            {editingId === tab.id ? (
              <input
                autoFocus
                aria-label="Rename tab"
                className="tab-name-input"
                defaultValue={tab.name}
                onBlur={(e) => {
                  renameTab(tab.id, e.target.value || tab.name);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameTab(tab.id, (e.target as HTMLInputElement).value || tab.name);
                    setEditingId(null);
                  }
                  if (e.key === "Escape") setEditingId(null);
                }}
              />
            ) : (
              <span className="tab-name">{tab.name}</span>
            )}
            <button
              className="tab-close"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="tabbar-actions">
        {activeTab && (
          <button
            type="button"
            className={"workspace-folder-pill" + (activeTab.projectPath ? " is-set" : "")}
            onClick={pickWorkspaceFolder}
            title={
              activeTab.projectPath
                ? `Workspace folder: ${activeTab.projectPath}\nClick to change`
                : "Click to choose this workspace's project folder"
            }
            aria-label={
              activeTab.projectPath
                ? `Change workspace folder (current: ${activeTab.projectPath})`
                : "Set workspace folder"
            }
          >
            <Icon name="folder-tree" size={13} />
            <span className="workspace-folder-pill-text">
              {activeTab.projectPath ? pathBasename(activeTab.projectPath) : "Set folder…"}
            </span>
          </button>
        )}
        <TemplatePickerTrigger />
        <TeamPickerTrigger />
      </div>
    </div>
  );
}
