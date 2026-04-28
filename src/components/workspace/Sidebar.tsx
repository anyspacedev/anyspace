import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useThemeStore } from "../../stores/themeStore";
import { useSttStore } from "../../stores/sttStore";
import { Icon, type IconName } from "../ui/Icon";

function displayHotkey(code: string): string {
  switch (code) {
    case "ControlRight": return "Right Ctrl";
    case "ControlLeft": return "Left Ctrl";
    case "AltRight": return "Right Alt";
    case "AltLeft": return "Left Alt";
    case "MetaRight": return "Right ⌘";
    case "MetaLeft": return "Left ⌘";
    case "ShiftRight": return "Right Shift";
    case "ShiftLeft": return "Left Shift";
    default: return code;
  }
}

const NAV_ITEMS: Array<{
  id: "workspace" | "kanban" | "agents" | "settings";
  label: string;
  icon: IconName;
}> = [
  { id: "workspace", label: "Workspaces", icon: "layers" },
  { id: "kanban", label: "Tasks", icon: "list-checks" },
  { id: "agents", label: "Agents", icon: "sparkles" },
  { id: "settings", label: "Settings", icon: "settings" },
];

export function Sidebar() {
  const view = useWorkspaceStore((s) => s.selectedView);
  const setView = useWorkspaceStore((s) => s.setView);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const taskCount = useKanbanStore((s) =>
    s.tasks.filter((t) => t.column !== "complete").length,
  );
  const theme = useThemeStore((s) => s.current);
  const sttHotkey = useSttStore((s) => s.settings.hotkey);

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div
          className="brand-mark"
          style={{
            background: `linear-gradient(135deg, ${theme.ui.accent}, ${theme.ui.info})`,
            color: theme.ui.accentFg,
          }}
        >
          T
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
            aria-current={view === item.id ? "page" : undefined}
            onClick={() => setView(item.id)}
          >
            <span className="nav-icon">
              <Icon name={item.icon} size={16} />
            </span>
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
        <div className="hint">
          Hold <kbd>{displayHotkey(sttHotkey)}</kbd> to talk
        </div>
      </div>
    </aside>
  );
}
