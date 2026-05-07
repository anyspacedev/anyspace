import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";

const SETTINGS_KEY = "uiHints";

/**
 * Per-feature "have I shown this coachmark yet" flags. Adding a new key
 * means adding it here AND on the State below; the loader spreads stored
 * values over defaults, so unknown keys are tolerated.
 */
type Hints = {
  seenPaneDragCoachmark: boolean;
};

const DEFAULTS: Hints = {
  seenPaneDragCoachmark: false,
};

type State = {
  hints: Hints;
  loaded: boolean;
  load: () => Promise<void>;
  mark: <K extends keyof Hints>(key: K) => Promise<void>;
};

export const useUiHintsStore = create<State>((set, get) => ({
  hints: DEFAULTS,
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const stored = await settingsGet<Partial<Hints>>(SETTINGS_KEY);
      set({
        hints: { ...DEFAULTS, ...(stored ?? {}) },
        loaded: true,
      });
    } catch {
      set({ loaded: true });
    }
  },

  mark: async (key) => {
    if (get().hints[key]) return;
    const next: Hints = { ...get().hints, [key]: true };
    set({ hints: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },
}));
