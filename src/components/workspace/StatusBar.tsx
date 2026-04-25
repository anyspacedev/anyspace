import { useThemeStore } from "../../stores/themeStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { themes } from "../../themes/definitions";

export function StatusBar() {
  const theme = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const paneCount = tab ? Object.keys(tab.panes).length : 0;

  return (
    <div className="statusbar">
      <div className="status-left">
        <span>Teamship 0.1.0</span>
        <span className="status-divider" />
        <span>{tabs.length} tab{tabs.length === 1 ? "" : "s"}</span>
        <span className="status-divider" />
        <span>{paneCount} pane{paneCount === 1 ? "" : "s"}</span>
      </div>
      <div className="status-right">
        <select
          className="theme-select"
          value={theme.id}
          onChange={(e) => setTheme(e.target.value)}
        >
          {themes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
