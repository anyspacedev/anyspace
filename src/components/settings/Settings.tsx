import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useThemeStore } from "../../stores/themeStore";
import { themes } from "../../themes/definitions";
import type { Theme } from "../../themes/definitions";
import { Icon } from "../ui/Icon";
import { useSttStore, type SttSettings } from "../../stores/sttStore";
import { useAiStore, type AiSettings } from "../../stores/aiStore";

export function Settings() {
  const theme = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);

  const darkCount = themes.filter((t) => t.kind === "dark").length;
  const lightCount = themes.length - darkCount;

  return (
    <div className="settings">
      <div className="settings-section">
        <div className="settings-section-head">
          <div className="settings-section-title">Appearance</div>
          <div className="settings-section-sub">
            {themes.length} themes — {darkCount} dark, {lightCount} light.
          </div>
        </div>
        <ThemeSelect value={theme} onChange={setTheme} />
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

      <SttSettingsSection />

      <AiSettingsSection />

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

function ThemeSwatch({ theme }: { theme: Theme }) {
  const { ui } = theme;
  return (
    <span className="theme-swatch-mini" aria-hidden="true">
      <span style={{ background: ui.bg }} />
      <span style={{ background: ui.bgElev }} />
      <span style={{ background: ui.accent }} />
      <span style={{ background: ui.success }} />
      <span style={{ background: ui.danger }} />
    </span>
  );
}

function ThemeSelect({
  value,
  onChange,
}: {
  value: Theme;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<HTMLInputElement | null>(null);
  const listboxId = useId();

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const match = (t: Theme) =>
      !q || t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q);
    return {
      dark: themes.filter((t) => t.kind === "dark" && match(t)),
      light: themes.filter((t) => t.kind === "light" && match(t)),
    };
  }, [filter]);

  const flat = useMemo(
    () => [...groups.dark, ...groups.light],
    [groups.dark, groups.light],
  );

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (
        !triggerRef.current?.contains(tgt) &&
        !panelRef.current?.contains(tgt)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setFilter("");
    const dark = themes.filter((t) => t.kind === "dark");
    const light = themes.filter((t) => t.kind === "light");
    const ordered = [...dark, ...light];
    const idx = ordered.findIndex((t) => t.id === value.id);
    setActiveIndex(idx >= 0 ? idx : 0);
    requestAnimationFrame(() => filterRef.current?.focus());
  }, [open, value.id]);

  useEffect(() => {
    if (activeIndex >= flat.length) setActiveIndex(Math.max(0, flat.length - 1));
  }, [flat.length, activeIndex]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIndex(Math.max(0, flat.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const t = flat[activeIndex];
      if (t) choose(t.id);
    }
  };

  const renderRow = (t: Theme) => {
    const idx = flat.indexOf(t);
    const selected = t.id === value.id;
    const highlighted = idx === activeIndex;
    return (
      <button
        key={t.id}
        type="button"
        role="option"
        aria-selected={selected}
        className={
          "theme-option" +
          (highlighted ? " hl" : "") +
          (selected ? " sel" : "")
        }
        onClick={() => choose(t.id)}
        onMouseEnter={() => setActiveIndex(idx)}
      >
        <ThemeSwatch theme={t} />
        <span className="theme-option-name">{t.name}</span>
        <span className="theme-option-kind">{t.kind}</span>
        {selected && (
          <span className="theme-option-check" aria-hidden="true">
            <Icon name="check" size={12} />
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="theme-select">
      <button
        ref={triggerRef}
        type="button"
        className={"theme-select-trigger" + (open ? " open" : "")}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={() => setOpen((v) => !v)}
      >
        <ThemeSwatch theme={value} />
        <span className="theme-select-label">
          <span className="theme-select-name">{value.name}</span>
          <span className="theme-select-kind">{value.kind}</span>
        </span>
        <span className="theme-select-chevron" aria-hidden="true">
          <Icon name={open ? "chevron-up" : "chevron-down"} size={14} />
        </span>
      </button>

      {open && (
        <div
          ref={panelRef}
          className="theme-select-panel"
          onKeyDown={onKeyDown}
        >
          <div className="theme-select-search">
            <span className="theme-select-search-icon" aria-hidden="true">
              <Icon name="search" size={14} />
            </span>
            <input
              ref={filterRef}
              placeholder="Filter themes…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              spellCheck={false}
              aria-label="Filter themes"
              aria-controls={listboxId}
            />
          </div>
          <div
            id={listboxId}
            role="listbox"
            aria-label="Themes"
            className="theme-select-list"
          >
            {flat.length === 0 ? (
              <div className="theme-select-empty">
                No themes match “{filter}”.
              </div>
            ) : (
              <>
                {groups.dark.length > 0 && (
                  <>
                    <div className="theme-select-group">Dark</div>
                    {groups.dark.map(renderRow)}
                  </>
                )}
                {groups.light.length > 0 && (
                  <>
                    <div className="theme-select-group">Light</div>
                    {groups.light.map(renderRow)}
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
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

const STT_PRESETS: Record<
  SttSettings["presetId"],
  { endpoint: string; model: string; label: string }
> = {
  groq: {
    endpoint: "https://api.groq.com/openai/v1",
    model: "whisper-large-v3-turbo",
    label: "Groq",
  },
  openai: {
    endpoint: "https://api.openai.com/v1",
    model: "whisper-1",
    label: "OpenAI",
  },
  custom: { endpoint: "", model: "", label: "Custom" },
};

function SttSettingsSection() {
  const settings = useSttStore((s) => s.settings);
  const update = useSttStore((s) => s.updateSettings);
  const [revealKey, setRevealKey] = useState(false);

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <div className="settings-section-title">Speech to text</div>
        <div className="settings-section-sub">
          Hold <kbd>Right Ctrl</kbd> to dictate. Transcribed text is pasted into the
          focused terminal or editor pane.
        </div>
      </div>

      <div className="stt-form">
        <label className="stt-field">
          <span className="stt-field-label">Provider</span>
          <select
            value={settings.presetId}
            onChange={(e) => {
              const id = e.target.value as SttSettings["presetId"];
              const preset = STT_PRESETS[id];
              if (id === "custom") {
                void update({ presetId: id });
              } else {
                void update({
                  presetId: id,
                  endpoint: preset.endpoint,
                  model: preset.model,
                });
              }
            }}
          >
            {Object.entries(STT_PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="stt-field">
          <span className="stt-field-label">Endpoint</span>
          <input
            type="url"
            value={settings.endpoint}
            placeholder="https://api.groq.com/openai/v1"
            onChange={(e) => void update({ endpoint: e.target.value })}
            spellCheck={false}
          />
        </label>

        <label className="stt-field">
          <span className="stt-field-label">API key</span>
          <div className="stt-field-inline">
            <input
              type={revealKey ? "text" : "password"}
              value={settings.apiKey}
              placeholder="sk-…"
              onChange={(e) => void update({ apiKey: e.target.value })}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={revealKey ? "Hide API key" : "Show API key"}
              onClick={() => setRevealKey((v) => !v)}
            >
              <Icon name={revealKey ? "x" : "dot"} size={14} />
            </button>
          </div>
        </label>

        <label className="stt-field">
          <span className="stt-field-label">Model</span>
          <input
            type="text"
            value={settings.model}
            placeholder="whisper-large-v3-turbo"
            onChange={(e) => void update({ model: e.target.value })}
            spellCheck={false}
          />
        </label>

        <label className="stt-field">
          <span className="stt-field-label">Language (optional)</span>
          <input
            type="text"
            value={settings.language}
            placeholder="auto-detect — e.g. en, es, zh"
            onChange={(e) => void update({ language: e.target.value })}
            spellCheck={false}
            maxLength={5}
          />
        </label>
      </div>
    </div>
  );
}

const AI_PRESETS: Record<
  AiSettings["presetId"],
  { endpoint: string; model: string; label: string }
> = {
  openai: {
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    label: "OpenAI",
  },
  groq: {
    endpoint: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
    label: "Groq",
  },
  openrouter: {
    endpoint: "https://openrouter.ai/api/v1",
    model: "anthropic/claude-3.5-haiku",
    label: "OpenRouter",
  },
  custom: { endpoint: "", model: "", label: "Custom" },
};

function AiSettingsSection() {
  const settings = useAiStore((s) => s.settings);
  const update = useAiStore((s) => s.updateSettings);
  const [revealKey, setRevealKey] = useState(false);

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <div className="settings-section-title">AI</div>
        <div className="settings-section-sub">
          Powers the <em>Explain</em> action on terminal command blocks. Uses an
          OpenAI-compatible <code>/chat/completions</code> endpoint.
        </div>
      </div>

      <div className="stt-form">
        <label className="stt-field">
          <span className="stt-field-label">Provider</span>
          <select
            value={settings.presetId}
            onChange={(e) => {
              const id = e.target.value as AiSettings["presetId"];
              const preset = AI_PRESETS[id];
              if (id === "custom") {
                void update({ presetId: id });
              } else {
                void update({
                  presetId: id,
                  endpoint: preset.endpoint,
                  model: preset.model,
                });
              }
            }}
          >
            {Object.entries(AI_PRESETS).map(([id, p]) => (
              <option key={id} value={id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>

        <label className="stt-field">
          <span className="stt-field-label">Endpoint</span>
          <input
            type="url"
            value={settings.endpoint}
            placeholder="https://api.openai.com/v1"
            onChange={(e) => void update({ endpoint: e.target.value })}
            spellCheck={false}
          />
        </label>

        <label className="stt-field">
          <span className="stt-field-label">API key</span>
          <div className="stt-field-inline">
            <input
              type={revealKey ? "text" : "password"}
              value={settings.apiKey}
              placeholder="sk-…"
              onChange={(e) => void update({ apiKey: e.target.value })}
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={revealKey ? "Hide API key" : "Show API key"}
              onClick={() => setRevealKey((v) => !v)}
            >
              <Icon name={revealKey ? "x" : "dot"} size={14} />
            </button>
          </div>
        </label>

        <label className="stt-field">
          <span className="stt-field-label">Model</span>
          <input
            type="text"
            value={settings.model}
            placeholder="gpt-4o-mini"
            onChange={(e) => void update({ model: e.target.value })}
            spellCheck={false}
          />
        </label>

        <label className="stt-field">
          <span className="stt-field-label">System prompt</span>
          <textarea
            value={settings.systemPrompt}
            rows={3}
            onChange={(e) => void update({ systemPrompt: e.target.value })}
            spellCheck={false}
          />
        </label>
      </div>
    </div>
  );
}
