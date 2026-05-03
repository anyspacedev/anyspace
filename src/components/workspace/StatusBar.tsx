import { useThemeStore } from "../../stores/themeStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useOperatorInboxStore } from "../../stores/operatorInboxStore";
import { handoffInboxToSuperAgent } from "../../lib/operatorInboxHandoff";
import { themes } from "../../themes/definitions";

export function StatusBar() {
  const theme = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const paneCount = tab ? Object.keys(tab.panes).length : 0;
  const inboxCount = useOperatorInboxStore((s) => s.pings.length);
  const markAllRead = useOperatorInboxStore((s) => s.markAllRead);

  const darkThemes = themes.filter((t) => t.kind === "dark");
  const lightThemes = themes.filter((t) => t.kind === "light");

  return (
    <div className="statusbar">
      <div className="status-left">
        <span>Teamship 0.1.0</span>
        <span className="status-divider" />
        <span>{tabs.length} tab{tabs.length === 1 ? "" : "s"}</span>
        <span className="status-divider" />
        <span>{paneCount} pane{paneCount === 1 ? "" : "s"}</span>
        {inboxCount > 0 && (
          <>
            <span className="status-divider" />
            <button
              type="button"
              className="status-inbox-badge"
              title={`${inboxCount} unread @operator message${inboxCount === 1 ? "" : "s"} — click to hand off to Super Agent (Alt+click to dismiss)`}
              onClick={(e) => {
                if (e.altKey) {
                  markAllRead();
                  return;
                }
                void handoffInboxToSuperAgent().catch((err) =>
                  console.warn("[inbox] handoff failed", err),
                );
              }}
            >
              <span className="status-inbox-dot" />
              {inboxCount} @operator
            </button>
          </>
        )}
      </div>
      <div className="status-right">
        <span className="status-theme">
          <span
            className="status-theme-dot"
            style={{ background: theme.ui.accent, boxShadow: `0 0 6px ${theme.ui.accent}` }}
          />
          <select
            className="theme-select"
            value={theme.id}
            onChange={(e) => setTheme(e.target.value)}
            aria-label="Theme"
          >
            <optgroup label="Dark">
              {darkThemes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
            <optgroup label="Light">
              {lightThemes.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </optgroup>
          </select>
        </span>
      </div>
    </div>
  );
}
