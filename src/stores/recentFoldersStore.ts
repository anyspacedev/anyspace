import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";

const SETTINGS_KEY = "recentFolders";
const MAX_RECENTS = 10;

type State = {
  recents: string[];
  loaded: boolean;
  load: () => Promise<void>;
  push: (path: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
};

export const useRecentFoldersStore = create<State>((set, get) => ({
  recents: [],
  loaded: false,

  load: async () => {
    if (get().loaded) return;
    try {
      const stored = await settingsGet<string[]>(SETTINGS_KEY);
      const list = Array.isArray(stored) ? stored.filter((x) => typeof x === "string") : [];
      set({ recents: list.slice(0, MAX_RECENTS), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  push: async (path) => {
    if (!path) return;
    const next = [path, ...get().recents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
    set({ recents: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },

  remove: async (path) => {
    const next = get().recents.filter((p) => p !== path);
    set({ recents: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort */
    }
  },
}));
