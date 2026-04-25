import { useMemo, useState } from "react";
import { useThemeStore } from "../../stores/themeStore";
import { themes } from "../../themes/definitions";
import type { Theme } from "../../themes/definitions";
import { Icon } from "../ui/Icon";

export function Settings() {
  const theme = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);
  const [filter, setFilter] = useState("");

  const { dark, light } = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (t: Theme) =>
      !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
    return {
      dark: themes.filter((t) => t.kind === "dark" && match(t)),
      light: themes.filter((t) => t.kind === "light" && match(t)),
    };
  }, [filter]);

  const totalShown = dark.length + light.length;

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-section-head">
          <div className="settings-section-title">Appearance</div>
          <div className="settings-section-sub">
            {themes.length} themes — {themes.filter((t) => t.kind === "dark").length} dark,{" "}
            {themes.filter((t) => t.kind === "light").length} light
          </div>
        </div>

        <div className="theme-search">
          <span className="theme-search-icon" aria-hidden="true">
            <Icon name="search" size={14} />
          </span>
          <input
            placeholder="Filter themes…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            spellCheck={false}
          />
          {filter && (
            <button
              className="icon-btn"
              onClick={() => setFilter("")}
              aria-label="Clear filter"
            >
              <Icon name="x" size={14} />
            </button>
          )}
        </div>

        {totalShown === 0 ? (
          <div className="theme-empty">
            <Icon name="search" size={20} />
            <div>No themes match “{filter}”.</div>
          </div>
        ) : (
          <>
            {dark.length > 0 && (
              <>
                <div className="settings-subhead">Dark</div>
                <ThemeGrid items={dark} activeId={theme.id} onPick={setTheme} />
              </>
            )}
            {light.length > 0 && (
              <>
                <div className="settings-subhead">Light</div>
                <ThemeGrid items={light} activeId={theme.id} onPick={setTheme} />
              </>
            )}
          </>
        )}
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
      {items.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            className={"theme-card" + (active ? " active" : "")}
            onClick={() => onPick(t.id)}
            aria-pressed={active}
          >
            <ThemePreview theme={t} />
            <div className="theme-swatch">
              <span style={{ background: t.ui.bg }} />
              <span style={{ background: t.ui.bgElev }} />
              <span style={{ background: t.ui.accent }} />
              <span style={{ background: t.ui.success }} />
              <span style={{ background: t.ui.danger }} />
              <span style={{ background: t.ui.warning }} />
            </div>
            <div className="theme-card-foot">
              <div className="theme-card-foot-text">
                <div className="theme-name">{t.name}</div>
                <div className="theme-kind">{t.kind}</div>
              </div>
              {active && (
                <div className="theme-active-pill" aria-hidden="true">
                  <Icon name="check" size={12} />
                  <span>Active</span>
                </div>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ThemePreview({ theme }: { theme: Theme }) {
  const { ui } = theme;
  return (
    <div
      className="theme-preview"
      style={{ background: ui.bg, borderColor: ui.border }}
      aria-hidden="true"
    >
      <div
        className="theme-preview-sidebar"
        style={{ background: ui.bgElev, borderRightColor: ui.border }}
      >
        <span style={{ background: ui.accent }} />
        <span style={{ background: ui.fgDim }} />
        <span style={{ background: ui.fgDim }} />
      </div>
      <div className="theme-preview-main">
        <div
          className="theme-preview-row"
          style={{ background: ui.bgElev, borderLeftColor: ui.success }}
        />
        <div
          className="theme-preview-row"
          style={{ background: ui.bgElev, borderLeftColor: ui.danger }}
        />
        <div
          className="theme-preview-btn"
          style={{ background: ui.accent, color: ui.accentFg }}
        >
          Run
        </div>
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
