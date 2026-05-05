import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";

const SETTINGS_KEY = "superAgent";

const PANEL_WIDTH_MIN = 280;
const PANEL_WIDTH_MAX = 720;
const clampPanelWidth = (n: number) =>
  Math.max(PANEL_WIDTH_MIN, Math.min(PANEL_WIDTH_MAX, Math.round(n)));

const DEFAULT_SYSTEM_PROMPT =
  "You are Super Agent, an in-app coding assistant embedded in a multi-pane terminal app. " +
  "You can call tools to inspect the workspace (list panes, read terminal output, list dirs, " +
  "read files, git status) and to act on it (open terminals, write commands into panes, create " +
  "kanban tasks, send team messages, launch teams). " +
  "Prefer reading before writing. When you take an action, briefly explain why. " +
  "Tool calls are executed in trust mode — be deliberate and never run destructive commands without confirmation in chat.";

export type SuperAgentSettings = {
  /** Inherits from settings.ai by default; overrides only if non-empty. */
  endpoint: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  memoryWindow: number;
  maxToolCallsPerTurn: number;
  streaming: boolean;
  /** Per-tool enable map. Missing key = enabled (default). false = disabled, stripped from
   *  the model's tools[] payload and short-circuited at execution. */
  toolEnabled: Record<string, boolean>;
  panelWidth: number;
  panelOpen: boolean;
  activeSessionId: string | null;
};

const DEFAULT_SETTINGS: SuperAgentSettings = {
  endpoint: "",
  apiKey: "",
  model: "",
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  memoryWindow: 30,
  maxToolCallsPerTurn: 6,
  streaming: true,
  toolEnabled: {},
  panelWidth: 360,
  panelOpen: false,
  activeSessionId: null,
};

type SuperAgentSettingsState = {
  settings: SuperAgentSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (partial: Partial<SuperAgentSettings>) => Promise<void>;
  setToolEnabled: (toolName: string, enabled: boolean) => Promise<void>;
  setPanelWidth: (width: number) => void;
  savePanelWidth: (width: number) => Promise<void>;
};

export const useSuperAgentSettingsStore = create<SuperAgentSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const stored = await settingsGet<Partial<SuperAgentSettings>>(SETTINGS_KEY);
      if (stored) {
        set({
          settings: {
            ...DEFAULT_SETTINGS,
            ...stored,
            toolEnabled: stored.toolEnabled && typeof stored.toolEnabled === "object"
              ? stored.toolEnabled
              : {},
            panelWidth:
              typeof stored.panelWidth === "number"
                ? clampPanelWidth(stored.panelWidth)
                : DEFAULT_SETTINGS.panelWidth,
          },
          loaded: true,
        });
        return;
      }
    } catch {
      /* fall through */
    }
    set({ loaded: true });
  },

  update: async (partial) => {
    const next = { ...get().settings, ...partial };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },

  setToolEnabled: async (toolName, enabled) => {
    const next = {
      ...get().settings,
      toolEnabled: { ...get().settings.toolEnabled, [toolName]: enabled },
    };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },

  setPanelWidth: (width) => {
    const clamped = clampPanelWidth(width);
    set({ settings: { ...get().settings, panelWidth: clamped } });
  },

  savePanelWidth: async (width) => {
    const next = { ...get().settings, panelWidth: clampPanelWidth(width) };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },
}));

export function isToolEnabled(toolName: string, settings: SuperAgentSettings): boolean {
  // Default: enabled. Only false if explicitly disabled.
  return settings.toolEnabled[toolName] !== false;
}
