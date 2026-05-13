import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";
import type { PromptId } from "../lib/prompts";

const SETTINGS_KEY = "prompts";

export type PromptsSettings = {
  /** Per-prompt user overrides. Missing key falls back to compiled-in default;
   *  an empty string is stored as-is (a valid, if poor, override). */
  overrides: Partial<Record<PromptId, string>>;
};

const DEFAULT_SETTINGS: PromptsSettings = { overrides: {} };

type PromptsState = {
  settings: PromptsSettings;
  loaded: boolean;
  load: () => Promise<void>;
  update: (id: PromptId, value: string) => Promise<void>;
  reset: (id: PromptId) => Promise<void>;
};

export const usePromptsStore = create<PromptsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const stored = await settingsGet<Partial<PromptsSettings>>(SETTINGS_KEY);
      if (stored && stored.overrides && typeof stored.overrides === "object") {
        set({
          settings: { overrides: { ...stored.overrides } },
          loaded: true,
        });
        return;
      }
      set({ settings: DEFAULT_SETTINGS, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  update: async (id, value) => {
    const next: PromptsSettings = {
      overrides: { ...get().settings.overrides, [id]: value },
    };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },

  reset: async (id) => {
    const overrides = { ...get().settings.overrides };
    delete overrides[id];
    const next: PromptsSettings = { overrides };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },
}));
