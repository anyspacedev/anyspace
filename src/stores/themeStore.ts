import { create } from "zustand";
import { themes, themeById, type Theme } from "../themes/definitions";
import { applyTheme } from "../themes/apply";
import { settingsGet, settingsSet } from "../lib/tauri";

type ThemeState = {
  current: Theme;
  setTheme: (id: string) => void;
  cycle: () => void;
  load: () => Promise<void>;
};

export const useThemeStore = create<ThemeState>((set, get) => ({
  current: themes[0],
  setTheme: (id) => {
    const t = themeById(id);
    set({ current: t });
    applyTheme(t);
    void settingsSet("theme", id).catch(() => {});
  },
  cycle: () => {
    const idx = themes.findIndex((t) => t.id === get().current.id);
    const next = themes[(idx + 1) % themes.length];
    get().setTheme(next.id);
  },
  load: async () => {
    try {
      const id = await settingsGet<string>("theme");
      if (id) get().setTheme(id);
      else applyTheme(get().current);
    } catch {
      applyTheme(get().current);
    }
  },
}));
