import { useThemeStore } from "../../stores/themeStore";
import { themes } from "../../themes/definitions";
import type { Theme } from "../../themes/definitions";

export function Settings() {
  const theme = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);

  const dark = themes.filter((t) => t.kind === "dark");
  const light = themes.filter((t) => t.kind === "light");

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-section-head">
          <div className="settings-section-title">Appearance</div>
          <div className="settings-section-sub">
            {themes.length} themes — {dark.length} dark, {light.length} light
          </div>
        </div>

        <div className="settings-subhead">Dark</div>
        <ThemeGrid items={dark} activeId={theme.id} onPick={setTheme} />

        <div className="settings-subhead">Light</div>
        <ThemeGrid items={light} activeId={theme.id} onPick={setTheme} />
      </div>

      <div className="settings-section">
        <div className="settings-section-head">
          <div className="settings-section-title">Keyboard</div>
          <div className="settings-section-sub">Built-in shortcuts</div>
        </div>
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

      <div className="settings-section">
        <div className="settings-section-head">
          <div className="settings-section-title">About</div>
          <div className="settings-section-sub">
            Teamship 0.1.0 — multi-pane terminal multiplexer with command blocks,
            Monaco editor, live preview, and Kanban-driven AI agent launcher.
          </div>
        </div>
      </div>
    </div>
  );
}

function ThemeGrid({
  items,
  activeId,
  onPick,
}: {
  items: Theme[];
  activeId: string;
  onPick: (id: string) => void;
}) {
  return (
    <div className="theme-grid">
      {items.map((t) => (
        <button
          key={t.id}
          className={"theme-card" + (t.id === activeId ? " active" : "")}
          onClick={() => onPick(t.id)}
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
