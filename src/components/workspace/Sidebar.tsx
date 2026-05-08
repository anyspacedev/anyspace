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
  { id: "agents", label: "Agents", icon: "play" },
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
      <div className="sidebar-brand" data-tauri-drag-region="deep">
        <svg
          className="brand-mark"
          data-tauri-drag-region=""
          viewBox="0 0 500 500"
          aria-hidden="true"
        >
          <rect x="0" y="0" width="500" height="500" rx="112.5" fill="#0f172a" />
          <rect x="68.75" y="112.5" width="100" height="275" rx="12.5" fill="#1e293b" stroke="#334155" strokeWidth="1.5" />
          <rect x="200" y="112.5" width="100" height="275" rx="12.5" fill="#1e293b" stroke="#334155" strokeWidth="1.5" />
          <rect x="331.25" y="112.5" width="100" height="275" rx="12.5" fill="#1e293b" stroke="#334155" strokeWidth="1.5" />
          <rect x="87.5" y="143.75" width="62.5" height="9.375" rx="3" fill="#64748b" />
          <rect x="87.5" y="168.75" width="43.75" height="9.375" rx="3" fill="#64748b" />
          <rect x="218.75" y="143.75" width="62.5" height="9.375" rx="3" fill="#64748b" />
          <rect x="218.75" y="168.75" width="50" height="9.375" rx="3" fill="#64748b" />
          <rect x="350" y="143.75" width="62.5" height="9.375" rx="3" fill="#64748b" />
          <rect x="218.75" y="200" width="62.5" height="9.375" rx="3" fill="#10b981" />
          <rect x="287.5" y="190.625" width="6.25" height="28.125" fill="#10b981">
            <animate attributeName="opacity" values="1;0;1" dur="1s" repeatCount="indefinite" />
          </rect>
        </svg>
        <div className="brand-text" data-tauri-drag-region="">
          <div className="brand-name" data-tauri-drag-region="">AnySpace</div>
          <div className="brand-sub" data-tauri-drag-region="">{theme.name}</div>
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
