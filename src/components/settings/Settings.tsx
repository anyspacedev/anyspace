import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
  useUser,
} from "@clerk/clerk-react";
import { useThemeStore } from "../../stores/themeStore";
import { themes } from "../../themes/definitions";
import type { Theme } from "../../themes/definitions";
import { Icon } from "../ui/Icon";
import { useSttStore, type SttSettings } from "../../stores/sttStore";
import { useAiStore, type AiSettings } from "../../stores/aiStore";
import { useProxyStore, type ProxySettings } from "../../stores/proxyStore";
import {
  useSuperAgentSettingsStore,
  isToolEnabled,
} from "../../stores/superAgentSettingsStore";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { TOOLS } from "../../lib/superAgent/tools";
import { useTeamSettingsStore } from "../../stores/teamSettingsStore";
import { useTeamStore } from "../../stores/teamStore";
import {
  BUILTIN_ROLES,
  isBuiltinRole,
  roleAccent,
  roleLabel,
  type TeamCustomRole,
} from "../../lib/teamRoles";
import { BUILTIN_SKILLS, type TeamSkill } from "../../lib/teamSkills";

const CLERK_CONFIGURED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function Settings() {
  const theme = useThemeStore((s) => s.current);
  const setTheme = useThemeStore((s) => s.setTheme);

  const darkCount = themes.filter((t) => t.kind === "dark").length;
  const lightCount = themes.length - darkCount;

  return (
    <div className="settings">
      <AccountSection />

      <div className="settings-section">
        <div className="settings-section-head">
          <h2 className="settings-section-title">Appearance</h2>
          <div className="settings-section-sub">
            {themes.length} themes — {darkCount} dark, {lightCount} light.
          </div>
        </div>
        <ThemeSelect value={theme} onChange={setTheme} />
      </div>

      <div className="settings-section">
        <div className="settings-section-head">
          <h2 className="settings-section-title">Keyboard</h2>
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

      <SuperAgentSettingsSection />

      <TeamSettingsSection />

      <ProxySettingsSection />

      <div className="settings-section">
        <div className="settings-section-head">
          <h2 className="settings-section-title">About</h2>
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
  "teamship-cloud": {
    // Endpoint resolved at call time from VITE_TEAMSHIP_CLOUD_URL so
    // a stale value never persists across releases.
    endpoint: "",
    model: "sense-voice-int8",
    label: "Teamship Cloud (beta)",
  },
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
  elevenlabs: {
    endpoint: "https://api.elevenlabs.io/v1",
    model: "scribe_v1",
    label: "ElevenLabs",
  },
  custom: { endpoint: "", model: "", label: "Custom" },
};

const HOTKEY_LABELS: Record<string, string> = {
  ControlLeft: "Left Ctrl",
  ControlRight: "Right Ctrl",
  AltLeft: "Left Alt/Option",
  AltRight: "Right Alt/Option",
  MetaLeft: "Left Cmd/Win",
  MetaRight: "Right Cmd/Win",
  ShiftLeft: "Left Shift",
  ShiftRight: "Right Shift",
  Space: "Space",
  Backquote: "`",
};

function formatHotkey(code: string): string {
  return HOTKEY_LABELS[code] ?? code;
}

function HotkeyField({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "Escape") {
        setCapturing(false);
        return;
      }
      if (!e.code) return;
      onChange(e.code);
      setCapturing(false);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKey, { capture: true });
  }, [capturing, onChange]);

  return (
    <button
      type="button"
      className={"stt-hotkey-btn" + (capturing ? " capturing" : "")}
      onClick={() => setCapturing((v) => !v)}
      aria-label="Set hold-to-talk hotkey"
    >
      {capturing ? "Press a key… (Esc to cancel)" : formatHotkey(value)}
    </button>
  );
}

function SttSettingsSection() {
  const settings = useSttStore((s) => s.settings);
  const update = useSttStore((s) => s.updateSettings);
  const [revealKey, setRevealKey] = useState(false);

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Speech to text</h2>
        <div className="settings-section-sub">
          Hold <kbd>{formatHotkey(settings.hotkey)}</kbd> to dictate. Transcribed
          text is pasted into the focused input, terminal, or editor.
        </div>
      </div>

      <div className="stt-form">
        <label className="stt-field">
          <span className="stt-field-label">Hotkey</span>
          <HotkeyField
            value={settings.hotkey}
            onChange={(code) => void update({ hotkey: code })}
          />
        </label>

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
          <span className="stt-field-label">
            API key
            {settings.presetId === "elevenlabs" && (
              <span className="stt-field-hint"> — sent as xi-api-key</span>
            )}
          </span>
          <div className="stt-field-inline">
            <input
              type={revealKey ? "text" : "password"}
              value={settings.apiKey}
              placeholder={
                settings.presetId === "elevenlabs" ? "xi-…" : "sk-…"
              }
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
        <h2 className="settings-section-title">AI</h2>
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

function ProxySettingsSection() {
  const settings = useProxyStore((s) => s.settings);
  const update = useProxyStore((s) => s.updateSettings);
  const [showAdvanced, setShowAdvanced] = useState(
    () => Boolean(settings.httpUrl || settings.httpsUrl),
  );

  const setMode = (mode: ProxySettings["mode"]) => void update({ mode });

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Network proxy</h2>
        <div className="settings-section-sub">
          Routes API calls (STT, AI, preview probes) through an HTTP or SOCKS5
          proxy. Loopback addresses are always reached directly. The browser
          preview iframe and auto-updater use a direct connection.
        </div>
      </div>

      <div className="stt-form">
        <label className="stt-field">
          <span className="stt-field-label">Mode</span>
          <select
            value={settings.mode}
            onChange={(e) => setMode(e.target.value as ProxySettings["mode"])}
          >
            <option value="off">Off — direct connection</option>
            <option value="manual">Manual</option>
          </select>
        </label>

        {settings.mode === "manual" && (
          <>
            <label className="stt-field">
              <span className="stt-field-label">Proxy URL</span>
              <input
                type="text"
                value={settings.url}
                placeholder="http://host:port — or socks5://user:pass@host:port"
                onChange={(e) => void update({ url: e.target.value })}
                spellCheck={false}
                autoComplete="off"
                disabled={Boolean(settings.httpUrl || settings.httpsUrl)}
              />
            </label>

            <label className="stt-field">
              <span className="stt-field-label">No-proxy list</span>
              <input
                type="text"
                value={settings.noProxy}
                placeholder="comma-separated, e.g. *.internal,10.0.0.0/8"
                onChange={(e) => void update({ noProxy: e.target.value })}
                spellCheck={false}
              />
            </label>

            <label className="stt-field">
              <span className="stt-field-label">Per-scheme overrides</span>
              <button
                type="button"
                className="stt-hotkey-btn"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? "Hide" : "Show"}
              </button>
            </label>

            {showAdvanced && (
              <>
                <label className="stt-field">
                  <span className="stt-field-label">HTTP proxy</span>
                  <input
                    type="text"
                    value={settings.httpUrl}
                    placeholder="http://host:port (overrides URL above)"
                    onChange={(e) => void update({ httpUrl: e.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
                <label className="stt-field">
                  <span className="stt-field-label">HTTPS proxy</span>
                  <input
                    type="text"
                    value={settings.httpsUrl}
                    placeholder="http://host:port (overrides URL above)"
                    onChange={(e) => void update({ httpsUrl: e.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                  />
                </label>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function AccountSection() {
  if (!CLERK_CONFIGURED) {
    return (
      <div className="settings-section">
        <div className="settings-section-head">
          <h2 className="settings-section-title">Account</h2>
          <div className="settings-section-sub">
            Auth not configured. Set <code>VITE_CLERK_PUBLISHABLE_KEY</code>{" "}
            in <code>.env</code> and restart to enable Teamship Cloud.
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Account</h2>
        <div className="settings-section-sub">
          Sign in to use Teamship Cloud transcription. Your audio is decoded
          on our server, never stored.
        </div>
      </div>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="btn-primary" style={{ marginTop: 8 }}>
            Sign in
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <SignedInRow />
      </SignedIn>
    </div>
  );
}

function SignedInRow() {
  const { user } = useUser();
  const email =
    user?.primaryEmailAddress?.emailAddress ??
    user?.emailAddresses?.[0]?.emailAddress ??
    "(no email)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginTop: 8,
      }}
    >
      <UserButton afterSignOutUrl="/" />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ fontWeight: 500 }}>{user?.fullName || email}</div>
        <div style={{ color: "var(--mut, #888)", fontSize: 12 }}>{email}</div>
      </div>
    </div>
  );
}

function SuperAgentSettingsSection() {
  const settings = useSuperAgentSettingsStore((s) => s.settings);
  const update = useSuperAgentSettingsStore((s) => s.update);
  const setToolEnabled = useSuperAgentSettingsStore((s) => s.setToolEnabled);
  const ai = useAiStore((s) => s.settings);
  const activeSessionId = useSuperAgentStore((s) => s.activeSessionId);
  const resetSession = useSuperAgentStore((s) => s.resetSession);

  const effectiveEndpoint = settings.endpoint || ai.endpoint;
  const effectiveModel = settings.model || ai.model;
  const hasKey = Boolean(settings.apiKey || ai.apiKey);

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Super Agent</h2>
        <div className="settings-section-sub">
          The in-app chat agent. Defaults to the AI section's endpoint / API key / model unless
          you override below. Tools run in trust mode — disable any you don't want the model to call.
        </div>
      </div>
      <div className="stt-fields">
        <label className="stt-field">
          <span className="stt-field-label">Endpoint override (optional)</span>
          <input
            type="text"
            value={settings.endpoint}
            placeholder={ai.endpoint || "(uses AI section endpoint)"}
            onChange={(e) => void update({ endpoint: e.target.value })}
            spellCheck={false}
          />
        </label>

        <label className="stt-field">
          <span className="stt-field-label">API key override (optional)</span>
          <input
            type="password"
            value={settings.apiKey}
            placeholder={hasKey ? "(uses AI section key)" : "sk-…"}
            onChange={(e) => void update({ apiKey: e.target.value })}
            spellCheck={false}
            autoComplete="off"
          />
        </label>

        <label className="stt-field">
          <span className="stt-field-label">Model override (optional)</span>
          <input
            type="text"
            value={settings.model}
            placeholder={ai.model || "(uses AI section model)"}
            onChange={(e) => void update({ model: e.target.value })}
            spellCheck={false}
          />
        </label>

        <label className="stt-field">
          <span className="stt-field-label">System prompt</span>
          <textarea
            value={settings.systemPrompt}
            rows={5}
            onChange={(e) => void update({ systemPrompt: e.target.value })}
            spellCheck={false}
          />
        </label>

        <div className="form-row-inline" style={{ gap: 12 }}>
          <label className="stt-field" style={{ flex: 1 }}>
            <span className="stt-field-label">Memory window (turns)</span>
            <input
              type="number"
              min={1}
              max={200}
              value={settings.memoryWindow}
              onChange={(e) => void update({ memoryWindow: Math.max(1, Number(e.target.value) || 30) })}
            />
          </label>
          <label className="stt-field" style={{ flex: 1 }}>
            <span className="stt-field-label">Max tool calls / turn</span>
            <input
              type="number"
              min={0}
              max={32}
              value={settings.maxToolCallsPerTurn}
              onChange={(e) =>
                void update({ maxToolCallsPerTurn: Math.max(0, Number(e.target.value) || 6) })
              }
            />
          </label>
        </div>

        <label className="stt-field">
          <span className="stt-field-label">
            <input
              type="checkbox"
              checked={settings.streaming}
              onChange={(e) => void update({ streaming: e.target.checked })}
              style={{ marginRight: 6 }}
            />
            Stream tokens (falls back to one-shot if endpoint rejects stream:true)
          </span>
        </label>
      </div>

      <div className="settings-section-head" style={{ marginTop: 16 }}>
        <h3 className="settings-section-title" style={{ fontSize: 14 }}>Tools</h3>
        <div className="settings-section-sub">
          Disabled tools are stripped from the model's tools[] payload and short-circuited at
          execution if the model still names them. Effective endpoint:{" "}
          <code>{effectiveEndpoint || "(none)"}</code>
          {effectiveModel ? <> · <code>{effectiveModel}</code></> : null}
        </div>
      </div>
      <div className="sa-tools-list">
        {TOOLS.map((t) => (
          <label key={t.name} className="sa-tools-row">
            <input
              type="checkbox"
              checked={isToolEnabled(t.name, settings)}
              onChange={(e) => void setToolEnabled(t.name, e.target.checked)}
            />
            <div>
              <div className="sa-tools-name">
                <code>{t.name}</code>
                <span className={"sa-tools-kind" + (t.readOnly ? " ro" : " rw")}>
                  {t.readOnly ? "read" : "write"}
                </span>
              </div>
              <div className="sa-tools-desc">{t.description}</div>
            </div>
          </label>
        ))}
      </div>

      <div className="modal-actions" style={{ justifyContent: "flex-start", marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            if (!activeSessionId) return;
            void resetSession(activeSessionId);
          }}
          disabled={!activeSessionId}
          title={
            activeSessionId
              ? "Clear the current session's message history"
              : "No active session"
          }
        >
          Reset session memory
        </button>
      </div>
    </div>
  );
}

function TeamSettingsSection() {
  const customRoles = useTeamSettingsStore((s) => s.settings.customRoles);
  const customSkills = useTeamSettingsStore((s) => s.settings.customSkills);
  const templates = useTeamSettingsStore((s) => s.settings.templates);
  const saveCustomRoles = useTeamSettingsStore((s) => s.saveCustomRoles);
  const saveCustomSkills = useTeamSettingsStore((s) => s.saveCustomSkills);
  const saveTemplates = useTeamSettingsStore((s) => s.saveTemplates);

  const teams = useTeamStore((s) => s.teams);
  const teamAgents = useTeamStore((s) => s.agents);
  const teamSkills = useTeamStore((s) => s.skills);

  const activeTeamIds = useMemo(
    () => new Set(teams.filter((t) => t.status === "active").map((t) => t.id)),
    [teams],
  );

  const roleUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [tid, agents] of Object.entries(teamAgents)) {
      if (!activeTeamIds.has(tid)) continue;
      for (const a of agents) {
        counts.set(a.role, (counts.get(a.role) ?? 0) + 1);
      }
    }
    return counts;
  }, [teamAgents, activeTeamIds]);

  const skillUsage = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [tid, ids] of Object.entries(teamSkills)) {
      if (!activeTeamIds.has(tid)) continue;
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }, [teamSkills, activeTeamIds]);

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Team</h2>
        <div className="settings-section-sub">
          Roles, skills, and saved templates used when launching multi-agent
          teams from <kbd>⌘⇧T</kbd>.
        </div>
      </div>

      <TeamRolesBlock
        customRoles={customRoles}
        save={saveCustomRoles}
        usage={roleUsage}
      />

      <TeamSkillsBlock
        customSkills={customSkills}
        save={saveCustomSkills}
        usage={skillUsage}
      />

      <TeamTemplatesBlock templates={templates} save={saveTemplates} />
    </div>
  );
}

function TeamRolesBlock({
  customRoles,
  save,
  usage,
}: {
  customRoles: TeamCustomRole[];
  save: (next: TeamCustomRole[]) => Promise<void>;
  usage: Map<string, number>;
}) {
  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const submit = () => {
    const label = draftLabel.trim();
    const body = draftBody.trim();
    if (!label || !body) return;
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const id = `custom:${slug}-${Math.random().toString(36).slice(2, 6)}`;
    if (isBuiltinRole(id)) return;
    void save([...customRoles, { id, label, body }]);
    setDraftLabel("");
    setDraftBody("");
    setAdding(false);
  };

  return (
    <div className="team-settings-block">
      <div className="team-settings-block-head">
        <span className="team-settings-block-title">Custom roles</span>
        <span className="team-settings-block-sub">
          Built-in roles cover most cases — only add when you need behavior the
          existing five don't capture.
        </span>
      </div>

      <div className="team-settings-builtin-row">
        Built-in:
        {BUILTIN_ROLES.map((r) => (
          <span key={r} className="team-settings-builtin-chip">
            <span
              className="team-settings-builtin-dot"
              style={{ background: roleAccent(r, []) }}
            />
            {roleLabel(r, [])}
          </span>
        ))}
      </div>

      {customRoles.length === 0 ? (
        <div className="team-settings-empty">No custom roles yet.</div>
      ) : (
        <div className="team-custom-roles">
          {customRoles.map((role) => {
            const inUse = usage.get(role.id) ?? 0;
            return (
              <div key={role.id} className="team-custom-role">
                <div>
                  <div className="team-custom-role-head">
                    <strong>{role.label}</strong>
                    <span className="team-skill-tag">{role.id}</span>
                    {inUse > 0 && (
                      <span className="team-skill-tag" title="Active teams using this role">
                        {inUse} in use
                      </span>
                    )}
                  </div>
                  <div className="team-custom-role-body">{role.body}</div>
                </div>
                <div className="team-custom-role-actions">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => {
                      if (inUse > 0) return;
                      void save(customRoles.filter((c) => c.id !== role.id));
                    }}
                    disabled={inUse > 0}
                    title={
                      inUse > 0
                        ? `Used by ${inUse} active team${inUse === 1 ? "" : "s"} — archive or change those teams first`
                        : "Delete"
                    }
                  >
                    <Icon name="x" size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="team-custom-role-add">
          <input
            aria-label="New role label"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="Role label (e.g. Architect)"
            autoFocus
          />
          <textarea
            aria-label="System prompt body"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder='Behavioral / role instructions. Use ${BOARD_PATH} and ${MESSAGES_PATH} placeholders.'
            rows={3}
          />
          <div className="team-custom-role-add-actions" style={{ gap: 6 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAdding(false);
                setDraftLabel("");
                setDraftBody("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={!draftLabel.trim() || !draftBody.trim()}
            >
              Add role
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-with-icon"
          onClick={() => setAdding(true)}
          style={{ alignSelf: "flex-start" }}
        >
          <Icon name="plus" size={12} />
          <span>Add custom role</span>
        </button>
      )}
    </div>
  );
}

function TeamSkillsBlock({
  customSkills,
  save,
  usage,
}: {
  customSkills: TeamSkill[];
  save: (next: TeamSkill[]) => Promise<void>;
  usage: Map<string, number>;
}) {
  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftBody, setDraftBody] = useState("");

  const submit = () => {
    const label = draftLabel.trim();
    const body = draftBody.trim();
    if (!label || !body) return;
    const id = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
    void save([...customSkills, { id, label, body }]);
    setDraftLabel("");
    setDraftBody("");
    setAdding(false);
  };

  return (
    <div className="team-settings-block">
      <div className="team-settings-block-head">
        <span className="team-settings-block-title">Custom skills</span>
        <span className="team-settings-block-sub">
          Each skill is a one- or two-sentence behavioral directive added to
          every agent's system prompt.
        </span>
      </div>

      <div className="team-settings-builtin-row">
        Built-in:
        {BUILTIN_SKILLS.map((s) => (
          <span key={s.id} className="team-settings-builtin-chip" title={s.body}>
            {s.label}
          </span>
        ))}
      </div>

      {customSkills.length === 0 ? (
        <div className="team-settings-empty">No custom skills yet.</div>
      ) : (
        <div className="team-skill-grid">
          {customSkills.map((s) => {
            const inUse = usage.get(s.id) ?? 0;
            return (
              <div key={s.id} className="team-skill" style={{ gridTemplateColumns: "1fr" }}>
                <span className="team-skill-label">
                  {s.label}
                  {inUse > 0 && (
                    <span className="team-skill-tag" title="Active teams using this skill">
                      {inUse} in use
                    </span>
                  )}
                </span>
                <span className="team-skill-body">{s.body}</span>
                <button
                  type="button"
                  className="team-skill-delete"
                  onClick={() => {
                    if (inUse > 0) return;
                    void save(customSkills.filter((c) => c.id !== s.id));
                  }}
                  disabled={inUse > 0}
                  aria-label={`Delete custom skill ${s.label}`}
                  title={
                    inUse > 0
                      ? `Used by ${inUse} active team${inUse === 1 ? "" : "s"} — archive or change those teams first`
                      : "Delete"
                  }
                >
                  <Icon name="x" size={11} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {adding ? (
        <div className="team-skill-add">
          <input
            aria-label="New skill label"
            value={draftLabel}
            onChange={(e) => setDraftLabel(e.target.value)}
            placeholder="Skill label (e.g. Conventional Commits)"
            autoFocus
          />
          <input
            aria-label="New skill body"
            value={draftBody}
            onChange={(e) => setDraftBody(e.target.value)}
            placeholder="Behavioral directive — one or two sentences"
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setAdding(false);
                setDraftLabel("");
                setDraftBody("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={submit}
              disabled={!draftLabel.trim() || !draftBody.trim()}
            >
              Add
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="btn btn-ghost btn-with-icon"
          onClick={() => setAdding(true)}
          style={{ alignSelf: "flex-start" }}
        >
          <Icon name="plus" size={12} />
          <span>Add custom skill</span>
        </button>
      )}
    </div>
  );
}

function TeamTemplatesBlock({
  templates,
  save,
}: {
  templates: ReturnType<typeof useTeamSettingsStore.getState>["settings"]["templates"];
  save: (next: typeof templates) => Promise<void>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };
  const commitRename = () => {
    if (!editingId) return;
    const trimmed = draftName.trim();
    if (trimmed) {
      void save(
        templates.map((t) => (t.id === editingId ? { ...t, name: trimmed } : t)),
      );
    }
    setEditingId(null);
    setDraftName("");
  };

  return (
    <div className="team-settings-block">
      <div className="team-settings-block-head">
        <span className="team-settings-block-title">Saved templates</span>
        <span className="team-settings-block-sub">
          Created from the New Team modal's "Save as…" button.
        </span>
      </div>

      {templates.length === 0 ? (
        <div className="team-settings-empty">
          No saved templates yet.
        </div>
      ) : (
        <div className="team-roster">
          {templates.map((t) => (
            <div key={t.id} className="team-settings-template-row">
              {editingId === t.id ? (
                <input
                  className="team-settings-template-name-input"
                  value={draftName}
                  onChange={(e) => setDraftName(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitRename();
                    } else if (e.key === "Escape") {
                      setEditingId(null);
                      setDraftName("");
                    }
                  }}
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="team-settings-template-name"
                  onClick={() => startRename(t.id, t.name)}
                  title="Click to rename"
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "inherit",
                    font: "inherit",
                    cursor: "text",
                    textAlign: "left",
                  }}
                >
                  {t.name}
                </button>
              )}
              <span className="team-settings-template-meta">
                {t.roster.length} {t.roster.length === 1 ? "agent" : "agents"} ·{" "}
                {t.skillIds.length} {t.skillIds.length === 1 ? "skill" : "skills"}
              </span>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() =>
                  void save(templates.filter((x) => x.id !== t.id))
                }
                title="Delete"
                aria-label={`Delete template ${t.name}`}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
