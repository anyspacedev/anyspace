import { useEffect, useMemo, useRef, useState } from "react";
import { useThemeStore } from "../../stores/themeStore";
import { themes, type Theme } from "../../themes/definitions";
import { Icon } from "../ui/Icon";

/**
 * Compact theme picker for the status bar. Trigger is a 5-stop swatch of the
 * current theme; click opens a kind-grouped popover with hover-to-preview and
 * click-to-commit. Closing without selection restores the pre-hover theme.
 */
export function StatusBarThemePicker() {
  const current = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);

  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  // Capture the theme that was applied when the popover opened so we can
  // restore it if the user dismisses without committing.
  const baseRef = useRef<string>(current.id);

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (t: Theme) =>
      !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
    return {
      dark: themes.filter((t) => t.kind === "dark" && match(t)),
      light: themes.filter((t) => t.kind === "light" && match(t)),
    };
  }, [filter]);

  // Outside click + Escape close the popover and restore the baseline theme.
  useEffect(() => {
    if (!open) return;
    const restore = () => {
      if (useThemeStore.getState().current.id !== baseRef.current) {
        setTheme(baseRef.current);
      }
    };
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        restore();
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        restore();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setTheme]);

  const onTrigger = () => {
    if (!open) baseRef.current = current.id;
    setOpen((v) => !v);
    setFilter("");
  };

  const renderRow = (t: Theme) => {
    const isCurrent = t.id === current.id;
    return (
      <button
        key={t.id}
        type="button"
        role="option"
        aria-selected={isCurrent}
        className={"sb-theme-row" + (isCurrent ? " is-current" : "")}
        onMouseEnter={() => setTheme(t.id)}
        onClick={() => {
          // Click commits — clear baseline so close doesn't restore.
          baseRef.current = t.id;
          setTheme(t.id);
          setOpen(false);
        }}
        onFocus={() => setTheme(t.id)}
      >
        <ThemeSwatch theme={t} />
        <span className="sb-theme-row-name">{t.name}</span>
        {isCurrent && (
          <span className="sb-theme-row-check" aria-hidden="true">
            <Icon name="check" size={11} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="sb-theme-picker" ref={wrapRef}>
      <button
        type="button"
        className={"sb-theme-trigger" + (open ? " open" : "")}
        onClick={onTrigger}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={`Theme: ${current.name} (${current.kind}) — click to change`}
      >
        <ThemeSwatch theme={current} />
        <span className="sb-theme-trigger-name">{current.name}</span>
        <Icon name="chevron-up" size={11} />
      </button>
      {open && (
        <div className="sb-theme-panel" role="listbox" aria-label="Themes">
          <div className="sb-theme-search">
            <Icon name="search" size={12} />
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter…"
              spellCheck={false}
              aria-label="Filter themes"
            />
          </div>
          <div className="sb-theme-list">
            {groups.dark.length > 0 && (
              <>
                <div className="sb-theme-group">Dark</div>
                {groups.dark.map(renderRow)}
              </>
            )}
            {groups.light.length > 0 && (
              <>
                <div className="sb-theme-group">Light</div>
                {groups.light.map(renderRow)}
              </>
            )}
            {groups.dark.length + groups.light.length === 0 && (
              <div className="sb-theme-empty">No themes match "{filter}"</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ThemeSwatch({ theme }: { theme: Theme }) {
  const { ui } = theme;
  return (
    <span className="sb-theme-swatch" aria-hidden="true">
      <span style={{ background: ui.bg }} />
      <span style={{ background: ui.bgElev }} />
      <span style={{ background: ui.accent }} />
      <span style={{ background: ui.success }} />
      <span style={{ background: ui.danger }} />
    </span>
  );
}
