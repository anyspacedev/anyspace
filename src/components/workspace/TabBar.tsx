import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useState } from "react";
import { TemplatePickerTrigger } from "./TemplatePicker";

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const view = useWorkspaceStore((s) => s.selectedView);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (view !== "workspace") {
    return (
      <div className="tabbar">
        <div className="tabbar-title">
          {view === "kanban" && "Task Board"}
          {view === "agents" && "Agents"}
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
            onClick={() => setActiveTab(tab.id)}
            onDoubleClick={() => setEditingId(tab.id)}
          >
            <span className="tab-color" style={{ background: tab.color }} />
            {editingId === tab.id ? (
              <input
                autoFocus
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
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <div className="tabbar-actions">
        <TemplatePickerTrigger />
      </div>
    </div>
  );
}
