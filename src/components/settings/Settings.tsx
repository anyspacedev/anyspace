import { useEffect, useMemo, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useThemeStore, type ThemeMode } from "../../stores/themeStore";
import { Icon } from "../ui/Icon";
import { useSttStore, type SttSettings } from "../../stores/sttStore";
import { useAiStore, type AiSettings } from "../../stores/aiStore";
import { useProxyStore, type ProxySettings } from "../../stores/proxyStore";
import { useSshHostsStore } from "../../stores/sshHostsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  useSuperAgentSettingsStore,
  isToolEnabled,
} from "../../stores/superAgentSettingsStore";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { TOOLS } from "../../lib/superAgent/tools";
import { ensureAgentApi, getCachedAgentApi } from "../../lib/agentApi";
import { agentApiRotateToken, type AgentApiInfo } from "../../lib/tauri";
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
import { ANYSPACE_CLOUD_URL } from "../../lib/auth";
import { LocalWhisperSection } from "./LocalWhisperSection";
import { AnySpaceCloudAccount } from "../auth/AnySpaceCloudAccount";
import { SettingsSearch } from "./SettingsSearch";
import { TestAiConnection } from "./TestConnection";

/**
 * Per-section keyword bag for the search filter. Adding a field means adding
 * its label here so users can find it. Cheaper than walking the rendered DOM.
 */
const SECTION_KEYWORDS: Record<string, string> = {
  appearance: "appearance theme mode dark light system color",
  keyboard: "keyboard shortcut hotkey keybinding",
  stt: "speech to text stt dictation transcribe microphone hotkey provider whisper groq elevenlabs language",
  ai: "ai openai anthropic groq openrouter chat completions endpoint api key model system prompt",
  "super-agent": "super agent chat tool tools memory window streaming vision pause",
  "code-agent-api": "code agent api token mcp loopback bearer",
  teams: "teams team multi agent role skill template coordinator developer reviewer qa",
  proxy: "proxy http https socks5 noproxy network",
  ssh: "ssh remote host bastion jump key identityfile port reconnect",
  about: "about version",
};

function sectionMatches(id: string, q: string): boolean {
  if (!q) return true;
  const hay = SECTION_KEYWORDS[id] ?? id;
  return hay.toLowerCase().includes(q.toLowerCase());
}

const SECTION_GROUPS = [
  {
    label: "General",
    items: [
      { id: "appearance", label: "Appearance" },
      { id: "keyboard", label: "Keyboard" },
    ],
  },
  {
    label: "AI",
    items: [
      { id: "stt", label: "Speech to text" },
      { id: "ai", label: "AI" },
      { id: "super-agent", label: "Super Agent" },
      { id: "code-agent-api", label: "Code Agent API" },
    ],
  },
  {
    label: "Collaboration",
    items: [{ id: "teams", label: "Multi-agent teams" }],
  },
  {
    label: "System",
    items: [
      { id: "proxy", label: "Network proxy" },
      { id: "ssh", label: "SSH hosts" },
      { id: "about", label: "About" },
    ],
  },
] as const;

const SECTION_IDS = SECTION_GROUPS.flatMap((g) => g.items.map((i) => i.id));

function SettingsNav({
  active,
  onJump,
  query,
  onQueryChange,
}: {
  active: string;
  onJump: (id: string) => void;
  query: string;
  onQueryChange: (q: string) => void;
}) {
  const filteredGroups = SECTION_GROUPS
    .map((g) => ({
      label: g.label,
      items: g.items.filter((i) => sectionMatches(i.id, query)),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <aside className="settings-nav" aria-label="Settings sections">
      <SettingsSearch value={query} onChange={onQueryChange} />
      {filteredGroups.length === 0 ? (
        <div className="settings-nav-empty">
          No sections match "{query}".
        </div>
      ) : (
        filteredGroups.map((group) => (
          <div key={group.label} className="settings-nav-group">
            <div className="settings-nav-group-label">{group.label}</div>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  "settings-nav-item" + (active === item.id ? " active" : "")
                }
                aria-current={active === item.id ? "true" : undefined}
                onClick={() => onJump(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ))
      )}
    </aside>
  );
}

export function Settings() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [activeId, setActiveId] = useState<string>(SECTION_IDS[0]);
  const [query, setQuery] = useState("");
  const [appVersion, setAppVersion] = useState<string>("");
  const gitSha = (import.meta.env.VITE_GIT_SHA as string | undefined) ?? "dev";

  useEffect(() => {
    let cancelled = false;
    getVersion()
      .then((v) => {
        if (!cancelled) setAppVersion(v);
      })
      .catch(() => {
        if (!cancelled) setAppVersion("");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-jump to the first matching section when the user starts a search,
  // so they don't have to scroll past dimmed-out blocks.
  useEffect(() => {
    if (!query) return;
    const first = SECTION_IDS.find((id) => sectionMatches(id, query));
    if (first) {
      const el = document.getElementById(first);
      if (el) {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
        setActiveId(first);
      }
    }
  }, [query]);

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  };

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        const first = visible[0];
        if (first) setActiveId(first.target.id);
      },
      { root, rootMargin: "-80px 0px -60% 0px", threshold: 0 },
    );
    SECTION_IDS.forEach((id) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    const onScroll = () => {
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
        setActiveId(SECTION_IDS[SECTION_IDS.length - 1]);
      }
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      root.removeEventListener("scroll", onScroll);
    };
  }, []);

  const sectionClass = (id: string) =>
    "settings-section-wrap" + (query && !sectionMatches(id, query) ? " is-dim" : "");

  return (
    <div className="settings">
      <SettingsNav
        active={activeId}
        onJump={jumpTo}
        query={query}
        onQueryChange={setQuery}
      />
      <div className="settings-content" ref={scrollRef}>
        <section id="appearance" aria-label="Appearance" className={sectionClass("appearance")}>
          <div className="settings-section">
            <div className="settings-section-head">
              <h2 className="settings-section-title">Appearance</h2>
              <div className="settings-section-sub">
                Choose how AnySpace looks. System follows your OS setting.
              </div>
            </div>
            <ThemeModePicker value={mode} onChange={setMode} />
          </div>
        </section>

        <section id="keyboard" aria-label="Keyboard" className={sectionClass("keyboard")}>
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
              <Row k="⌘⇧B" v="Suggest with AI (terminal)" />
            </div>
          </div>
        </section>

        <section id="stt" aria-label="Speech to text" className={sectionClass("stt")}>
          <SttSettingsSection />
        </section>

        <section id="ai" aria-label="AI" className={sectionClass("ai")}>
          <AiSettingsSection />
        </section>

        <section id="super-agent" aria-label="Super Agent" className={sectionClass("super-agent")}>
          <SuperAgentSettingsSection />
        </section>

        <section id="code-agent-api" aria-label="Code Agent API" className={sectionClass("code-agent-api")}>
          <CodeAgentApiSettingsSection />
        </section>

        <section id="teams" aria-label="Multi-agent teams" className={sectionClass("teams")}>
          <TeamSettingsSection />
        </section>

        <section id="proxy" aria-label="Network proxy" className={sectionClass("proxy")}>
          <ProxySettingsSection />
        </section>

        <section id="ssh" aria-label="SSH hosts" className={sectionClass("ssh")}>
          <SshSettingsSection />
        </section>

        <section id="about" aria-label="About" className={sectionClass("about")}>
          <div className="settings-section">
            <div className="settings-section-head">
              <h2 className="settings-section-title">About</h2>
              <div className="settings-section-sub">
                AnySpace {appVersion || "…"}{gitSha ? ` (${gitSha})` : ""} —
                multi-pane terminal multiplexer with command blocks, Monaco
                editor, live preview, and Kanban-driven AI agent launcher.
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

const THEME_MODE_OPTIONS: { value: ThemeMode; label: string; icon: "sun" | "moon" | "monitor" }[] = [
  { value: "light", label: "Light", icon: "sun" },
  { value: "dark", label: "Dark", icon: "moon" },
  { value: "system", label: "System", icon: "monitor" },
];

function ThemeModePicker({
  value,
  onChange,
}: {
  value: ThemeMode;
  onChange: (mode: ThemeMode) => void;
}) {
  const onKeyDown = (e: React.KeyboardEvent, idx: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const dir = e.key === "ArrowRight" ? 1 : -1;
    const next = (idx + dir + THEME_MODE_OPTIONS.length) % THEME_MODE_OPTIONS.length;
    onChange(THEME_MODE_OPTIONS[next].value);
  };

  return (
    <div className="theme-mode-picker" role="radiogroup" aria-label="Theme mode">
      {THEME_MODE_OPTIONS.map((opt, idx) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={"theme-mode-seg" + (selected ? " is-selected" : "")}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => onKeyDown(e, idx)}
          >
            <Icon name={opt.icon} size={14} />
            <span>{opt.label}</span>
          </button>
        );
      })}
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
  "anyspace-cloud": {
    // Endpoint resolved at call time from VITE_ANYSPACE_CLOUD_URL so
    // a stale value never persists across releases.
    endpoint: "",
    model: "sense-voice-int8",
    label: "AnySpace Cloud (beta)",
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
  "local-whisper": {
    // No endpoint/model — the picker below drives those for this preset.
    endpoint: "",
    model: "",
    label: "Local (Whisper) — on-device",
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
  const isAnySpaceCloud = settings.presetId === "anyspace-cloud";
  const isLocalWhisper = settings.presetId === "local-whisper";

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

        {isLocalWhisper ? (
          <LocalWhisperSection />
        ) : isAnySpaceCloud ? (
          <>
            <div className="stt-field">
              <span className="stt-field-label">Account</span>
              <AnySpaceCloudAccount />
            </div>
            <div className="stt-field">
              <span className="stt-field-label">
                Endpoint
                <span className="stt-field-hint"> — managed</span>
              </span>
              <input
                type="url"
                value={ANYSPACE_CLOUD_URL || "(not configured for this build)"}
                readOnly
                spellCheck={false}
              />
            </div>
          </>
        ) : (
          <>
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
          </>
        )}

        {!isLocalWhisper && (
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
        )}

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
  "anyspace-cloud": {
    // Endpoint resolved at call time from VITE_ANYSPACE_CLOUD_URL.
    endpoint: "",
    model: "anyspace-default",
    label: "AnySpace Cloud (beta)",
  },
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
  const isAnySpaceCloud = settings.presetId === "anyspace-cloud";

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

        {isAnySpaceCloud ? (
          <>
            <div className="stt-field">
              <span className="stt-field-label">Account</span>
              <AnySpaceCloudAccount />
            </div>
            <div className="stt-field">
              <span className="stt-field-label">
                Endpoint
                <span className="stt-field-hint"> — managed</span>
              </span>
              <input
                type="url"
                value={ANYSPACE_CLOUD_URL || "(not configured for this build)"}
                readOnly
                spellCheck={false}
              />
            </div>
            <label className="stt-field">
              <span className="stt-field-label">Model</span>
              <input
                type="text"
                value={settings.model}
                placeholder="anyspace-default"
                onChange={(e) => void update({ model: e.target.value })}
                spellCheck={false}
              />
            </label>
          </>
        ) : (
          <>
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
          </>
        )}

        <label className="stt-field">
          <span className="stt-field-label">System prompt</span>
          <textarea
            value={settings.systemPrompt}
            rows={3}
            onChange={(e) => void update({ systemPrompt: e.target.value })}
            spellCheck={false}
          />
        </label>

        {!isAnySpaceCloud && (
          <TestAiConnection
            endpoint={settings.endpoint}
            apiKey={settings.apiKey}
            model={settings.model}
          />
        )}
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

function SshSettingsSection() {
  const hosts = useSshHostsStore((s) => s.hosts);
  const setView = useWorkspaceStore((s) => s.setView);

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">SSH hosts</h2>
        <div className="settings-section-sub">
          Anyspace runs the system <code>ssh</code> binary as the PTY root
          process. Stored hosts spawn a fresh remote shell from the sidebar's
          Remotes view. <code>~/.ssh/config</code>, ControlMaster, jump hosts,
          and agent forwarding all work natively.
        </div>
      </div>

      <div className="stt-form">
        <div className="stt-field">
          <span className="stt-field-label">Stored hosts</span>
          <div className="ssh-settings-summary">
            <span>
              {hosts.length === 0
                ? "No hosts yet."
                : `${hosts.length} host${hosts.length === 1 ? "" : "s"} configured.`}
            </span>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setView("ssh")}
            >
              Open Remotes
            </button>
          </div>
        </div>

        <div className="stt-field">
          <span className="stt-field-label">Caveats</span>
          <ul className="ssh-settings-notes">
            <li>
              <strong>No command blocks or Super Brain on SSH panes.</strong>
              {" "}They depend on the local shell-integration hook, which
              isn't installed on the remote shell.
            </li>
            <li>
              <strong>Custom env vars need server cooperation.</strong>
              {" "}Per-host <code>SetEnv</code> entries only take effect if
              the remote <code>sshd</code> whitelists them via
              {" "}<code>AcceptEnv</code>.
            </li>
            <li>
              <strong>ControlMaster is shared.</strong>
              {" "}If your <code>~/.ssh/config</code> sets a fixed
              {" "}<code>ControlPath</code>, anyspace's SSH panes share the
              multiplex with any other ssh session on this machine.
            </li>
            <li>
              <strong>Windows requires WSL.</strong>
              {" "}<code>ssh</code> is invoked inside the WSL distro via
              {" "}<code>wsl.exe -e</code>; the Linux <code>ssh</code> binary
              must be available there.
            </li>
          </ul>
        </div>
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

  const hasKey = Boolean(settings.apiKey || ai.apiKey);
  const isInherit = settings.presetId === "inherit";
  const isAnySpaceCloud = settings.presetId === "anyspace-cloud";
  const aiIsAnySpaceCloud = ai.presetId === "anyspace-cloud";
  const effectiveEndpoint = isAnySpaceCloud
    ? ANYSPACE_CLOUD_URL
    : isInherit && aiIsAnySpaceCloud
      ? ANYSPACE_CLOUD_URL
      : settings.endpoint || ai.endpoint;
  const effectiveModel = settings.model || ai.model;

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Super Agent</h2>
        <div className="settings-section-sub">
          The in-app chat agent. Defaults to inheriting the AI section's
          provider — pick a different provider here to pin Super Agent
          independently. Tools run in trust mode — disable any you don't want
          the model to call.
        </div>
      </div>
      <div className="stt-fields">
        <label className="stt-field">
          <span className="stt-field-label">Provider</span>
          <select
            value={settings.presetId}
            onChange={(e) => {
              const id = e.target.value as typeof settings.presetId;
              if (id === "inherit" || id === "custom") {
                void update({ presetId: id });
              } else if (id === "anyspace-cloud") {
                void update({
                  presetId: id,
                  endpoint: "",
                  apiKey: "",
                  model: "anyspace-default",
                });
              } else {
                const preset = AI_PRESETS[id];
                void update({
                  presetId: id,
                  endpoint: preset.endpoint,
                  model: preset.model,
                });
              }
            }}
          >
            <option value="inherit">Inherit from AI section</option>
            <option value="anyspace-cloud">AnySpace Cloud (beta)</option>
            <option value="openai">OpenAI</option>
            <option value="groq">Groq</option>
            <option value="openrouter">OpenRouter</option>
            <option value="custom">Custom</option>
          </select>
        </label>

        {isAnySpaceCloud ? (
          <>
            <div className="stt-field">
              <span className="stt-field-label">Account</span>
              <AnySpaceCloudAccount />
            </div>
            <div className="stt-field">
              <span className="stt-field-label">
                Endpoint
                <span className="stt-field-hint"> — managed</span>
              </span>
              <input
                type="url"
                value={ANYSPACE_CLOUD_URL || "(not configured for this build)"}
                readOnly
                spellCheck={false}
              />
            </div>
            <label className="stt-field">
              <span className="stt-field-label">Model</span>
              <input
                type="text"
                value={settings.model}
                placeholder="anyspace-default"
                onChange={(e) => void update({ model: e.target.value })}
                spellCheck={false}
              />
            </label>
          </>
        ) : (
          <>
            <label className="stt-field">
              <span className="stt-field-label">
                {isInherit ? "Endpoint override (optional)" : "Endpoint"}
              </span>
              <input
                type="text"
                value={settings.endpoint}
                placeholder={ai.endpoint || "(uses AI section endpoint)"}
                onChange={(e) => void update({ endpoint: e.target.value })}
                spellCheck={false}
              />
            </label>

            <label className="stt-field">
              <span className="stt-field-label">
                {isInherit ? "API key override (optional)" : "API key"}
              </span>
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
              <span className="stt-field-label">
                {isInherit ? "Model override (optional)" : "Model"}
              </span>
              <input
                type="text"
                value={settings.model}
                placeholder={ai.model || "(uses AI section model)"}
                onChange={(e) => void update({ model: e.target.value })}
                spellCheck={false}
              />
            </label>
          </>
        )}

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
              max={100}
              value={settings.maxToolCallsPerTurn}
              onChange={(e) =>
                void update({ maxToolCallsPerTurn: Math.max(0, Number(e.target.value) || 25) })
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

        <label className="stt-field">
          <span className="stt-field-label">
            <input
              type="checkbox"
              checked={settings.enableVision !== false}
              onChange={(e) => void update({ enableVision: e.target.checked })}
              style={{ marginRight: 6 }}
            />
            Send screenshot images to vision-capable models
          </span>
          <span className="stt-field-hint">
            When the <code>capture_preview_screenshot</code> tool runs, the runner attaches the PNG to
            the next user turn as an <code>image_url</code> block. Disable for endpoints that reject
            multimodal content (some OpenAI-compatible proxies).
          </span>
        </label>

      </div>

      {!isAnySpaceCloud && !(isInherit && aiIsAnySpaceCloud) && (
        <TestAiConnection
          endpoint={effectiveEndpoint}
          apiKey={settings.apiKey || ai.apiKey}
          model={effectiveModel}
        />
      )}

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

function CodeAgentApiSettingsSection() {
  const [info, setInfo] = useState<AgentApiInfo | null>(getCachedAgentApi());
  const [copied, setCopied] = useState<string | null>(null);
  const [rotated, setRotated] = useState(false);

  useEffect(() => {
    if (info) return;
    let cancelled = false;
    void ensureAgentApi()
      .then((next) => {
        if (!cancelled) setInfo(next);
      })
      .catch(() => {
        /* server is optional */
      });
    return () => {
      cancelled = true;
    };
  }, [info]);

  // Literal ${VAR} references — Claude Code (and other MCP clients that
  // support env interpolation) re-resolves these at startup against the host
  // terminal pane's exported env, so each `claude` instance picks up the
  // pane / tab id of the terminal it's running in.
  const mcpAddCmd =
    'claude mcp add --transport http anyspace "${ANYSPACE_API_URL}/mcp" \\\n' +
    '  --header "Authorization: Bearer ${ANYSPACE_API_TOKEN}" \\\n' +
    '  --header "X-Pane-Id: ${ANYSPACE_PANE_ID}" \\\n' +
    '  --header "X-Tab-Id: ${ANYSPACE_TAB_ID}"';

  // For external clients (Cursor, Claude Desktop, Codex, Windsurf) running
  // outside a terminal pane, there are no env vars to interpolate — bake the
  // resolved URL + token directly into the install string. Tools that need
  // pane context fall back to the active workspace tab.
  const externalAddCmd =
    info?.url && info?.token
      ? `claude mcp add --transport http anyspace "${info.url}/mcp" \\\n` +
        `  --header "Authorization: Bearer ${info.token}"`
      : "claude mcp add --transport http anyspace \"<API URL>/mcp\" \\\n  --header \"Authorization: Bearer <token>\"";

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
      window.setTimeout(() => setCopied((c) => (c === label ? null : c)), 1500);
    } catch {
      /* clipboard may be denied — silent */
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Code Agent API</h2>
        <div className="settings-section-sub">
          Loopback HTTP MCP server that exposes the live preview, kanban tasks, project knowledge
          notes, team messages, and terminal context to MCP-aware clients (Claude Code, Cursor,
          Claude Desktop, Codex, Windsurf, Aider…). Each Code-Agent terminal gets{" "}
          <code>$ANYSPACE_API_URL</code>, <code>$ANYSPACE_API_TOKEN</code>, and{" "}
          <code>$ANYSPACE_PANE_ID</code> in its env; external clients can connect without those.
        </div>
      </div>
      <div className="stt-fields">
        <label className="stt-field">
          <span className="stt-field-label">Server URL</span>
          <input
            type="text"
            value={info?.url ?? "(starting…)"}
            readOnly
            spellCheck={false}
          />
        </label>
        <label className="stt-field">
          <span className="stt-field-label">Bearer token</span>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="password"
              value={info?.token ?? ""}
              readOnly
              spellCheck={false}
              autoComplete="off"
              style={{ flex: 1 }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!info?.token}
              onClick={() => info?.token && copy("token", info.token)}
            >
              {copied === "token" ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="stt-field-hint">
            Persisted to <code>app_config_dir/agent_api.json</code> (mode 0600 on Unix). Rotation
            invalidates long-lived agent shells — they will need to re-import{" "}
            <code>$ANYSPACE_API_TOKEN</code> after the next app restart.
          </span>
          <div style={{ marginTop: 6 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                void agentApiRotateToken().then(() => setRotated(true));
              }}
            >
              Rotate token
            </button>
            {rotated && (
              <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>
                New token written. Restart AnySpace to apply.
              </span>
            )}
          </div>
        </label>
        <label className="stt-field">
          <span className="stt-field-label">MCP server (Claude Code / Codex)</span>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              value={mcpAddCmd}
              readOnly
              spellCheck={false}
              rows={4}
              style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => copy("mcp", mcpAddCmd)}
            >
              {copied === "mcp" ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="stt-field-hint">
            Paste this into a Code-Agent terminal pane (where{" "}
            <code>$ANYSPACE_API_URL</code> / <code>$ANYSPACE_API_TOKEN</code> /{" "}
            <code>$ANYSPACE_PANE_ID</code> / <code>$ANYSPACE_TAB_ID</code> are already exported).
            Claude Code re-resolves the <code>${"${VAR}"}</code> references on each startup, so any
            terminal where you run <code>claude</code> sends its own pane and tab id.
          </span>
        </label>
        <label className="stt-field">
          <span className="stt-field-label">External clients (Cursor, Claude Desktop, Codex, Windsurf)</span>
          <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <textarea
              value={externalAddCmd}
              readOnly
              spellCheck={false}
              rows={2}
              style={{ flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={!info?.token}
              onClick={() => copy("mcp-external", externalAddCmd)}
            >
              {copied === "mcp-external" ? "Copied" : "Copy"}
            </button>
          </div>
          <span className="stt-field-hint">
            Use this from editors that run outside a Code-Agent terminal pane. No pane/tab headers —
            tools that need workspace context fall back to the currently active tab in AnySpace.
            The port changes on each app restart; re-run after a restart, or rotate the token to
            invalidate this install. See <code>/docs/integrations/mcp</code> for the full tool list.
          </span>
        </label>
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
        <h2 className="settings-section-title">Multi-agent teams</h2>
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
