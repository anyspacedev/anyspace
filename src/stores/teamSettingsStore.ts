import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";
import type { TeamSkill } from "../lib/teamSkills";

export type TeamSettings = {
  customSkills: TeamSkill[];
};

const DEFAULT_SETTINGS: TeamSettings = {
  customSkills: [],
};

const SETTINGS_KEY = "team";

type TeamSettingsState = {
  settings: TeamSettings;
  loaded: boolean;
  load: () => Promise<void>;
  saveCustomSkills: (skills: TeamSkill[]) => Promise<void>;
};

export const useTeamSettingsStore = create<TeamSettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const stored = await settingsGet<Partial<TeamSettings>>(SETTINGS_KEY);
      if (stored) {
        set({
          settings: {
            ...DEFAULT_SETTINGS,
            ...stored,
            customSkills: Array.isArray(stored.customSkills) ? stored.customSkills : [],
          },
          loaded: true,
        });
        return;
      }
    } catch {
      /* fall through to default */
    }
    set({ loaded: true });
  },

  saveCustomSkills: async (skills) => {
    const next = { ...get().settings, customSkills: skills };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },
}));
