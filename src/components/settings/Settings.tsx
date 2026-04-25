import { useThemeStore } from "../../stores/themeStore";
import { themes } from "../../themes/definitions";

export function Settings() {
  const theme = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className="settings">
      <div className="section-title">Appearance</div>
      <div className="theme-grid">
        {themes.map((t) => (
          <button
            key={t.id}
            className={"theme-card" + (t.id === theme.id ? " active" : "")}
            onClick={() => setTheme(t.id)}
          >
            <div className="theme-swatch">
              <span style={{ background: t.ui.bg }} />
              <span style={{ background: t.ui.bgElev }} />
              <span style={{ background: t.ui.accent }} />
              <span style={{ background: t.terminal.green }} />
              <span style={{ background: t.terminal.red }} />
              <span style={{ background: t.terminal.cyan }} />
            </div>
            <div className="theme-name">{t.name}</div>
            <div className="theme-kind">{t.kind}</div>
          </button>
        ))}
      </div>

      <div className="section-title">Keyboard</div>
      <div className="kbd-list">
        <Row k="⌘T" v="New workspace" />
        <Row k="⌘W" v="Close tab" />
        <Row k="⌘P" v="Quick Open" />
        <Row k="⌘D" v="Split pane horizontal" />
        <Row k="⌘⇧D" v="Split pane vertical" />
        <Row k="⌘1–9" v="Switch to tab N" />
        <Row k="⌘S" v="Save file (in editor)" />
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="kbd-row">
      <kbd>{k}</kbd>
      <span>{v}</span>
    </div>
  );
}
