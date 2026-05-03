import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";
import type { TeamSkill } from "../lib/teamSkills";
import type { TeamCustomRole, TeamRole } from "../lib/teamRoles";

export type TeamTemplateRosterRow = {
  role: TeamRole;
  label: string;
  /** Only stored as a hint. Resolved against the user's kanban agents list at
   * apply time; if missing, the picker falls back to the first available. */
  agentId?: string;
};

export type TeamTemplate = {
  id: string;
  name: string;
  goalSeed?: string;
  roster: TeamTemplateRosterRow[];
  skillIds: string[];
  /** When true, the picker auto-checks the template's name as the team name. */
  reuseTeamName?: boolean;
};

export type TeamSettings = {
  customSkills: TeamSkill[];
  customRoles: TeamCustomRole[];
  templates: TeamTemplate[];
};

const DEFAULT_SETTINGS: TeamSettings = {
  customSkills: [],
  customRoles: [],
  templates: [],
};

const SETTINGS_KEY = "team";

type TeamSettingsState = {
  settings: TeamSettings;
  loaded: boolean;
  load: () => Promise<void>;
  saveCustomSkills: (skills: TeamSkill[]) => Promise<void>;
  saveCustomRoles: (roles: TeamCustomRole[]) => Promise<void>;
  saveTemplates: (templates: TeamTemplate[]) => Promise<void>;
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
            customRoles: Array.isArray(stored.customRoles) ? stored.customRoles : [],
            templates: Array.isArray(stored.templates) ? stored.templates : [],
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

  saveCustomRoles: async (roles) => {
    const next = { ...get().settings, customRoles: roles };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },

  saveTemplates: async (templates) => {
    const next = { ...get().settings, templates };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },
}));
