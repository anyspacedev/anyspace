import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useThemeStore } from "../../stores/themeStore";

const NAV_ITEMS: Array<{ id: "workspace" | "kanban" | "agents" | "settings"; label: string; icon: string }> = [
  { id: "workspace", label: "Workspaces", icon: "▦" },
  { id: "kanban", label: "Tasks", icon: "≡" },
  { id: "agents", label: "Agents", icon: "✦" },
  { id: "settings", label: "Settings", icon: "⚙" },
];

export function Sidebar() {
  const view = useWorkspaceStore((s) => s.selectedView);
  const setView = useWorkspaceStore((s) => s.setView);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const taskCount = useKanbanStore((s) => s.tasks.filter((t) => t.column !== "complete").length);
  const theme = useThemeStore((s) => s.current);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark" style={{ background: theme.ui.accent }}>
          <span style={{ color: theme.ui.accentFg }}>T</span>
        </div>
        <div className="brand-text">
          <div className="brand-name">Teamship</div>
          <div className="brand-sub">{theme.name}</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={"nav-item" + (view === item.id ? " active" : "")}
            onClick={() => setView(item.id)}
          >
            <span className="nav-icon">{item.icon}</span>
            <span className="nav-label">{item.label}</span>
            {item.id === "workspace" && (
              <span className="nav-badge">{tabs.length}</span>
            )}
            {item.id === "kanban" && taskCount > 0 && (
              <span className="nav-badge">{taskCount}</span>
            )}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="hint">
          <kbd>⌘T</kbd> new tab
        </div>
        <div className="hint">
          <kbd>⌘P</kbd> quick open
        </div>
        <div className="hint">
          <kbd>⌘D</kbd> split
        </div>
      </div>
    </aside>
  );
}
