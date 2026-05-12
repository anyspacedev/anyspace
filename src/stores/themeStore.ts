import { create } from "zustand";
import { darkTheme, lightTheme, resolveSystemTheme, type Theme } from "../themes/definitions";
import { applyTheme } from "../themes/apply";
import { settingsGet, settingsSet } from "../lib/tauri";

export type ThemeMode = "light" | "dark" | "system";

type ThemeState = {
  mode: ThemeMode;
  resolved: Theme;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
  load: () => Promise<void>;
};

function resolve(mode: ThemeMode): Theme {
  if (mode === "light") return lightTheme;
  if (mode === "dark") return darkTheme;
  return resolveSystemTheme();
}

function isValidMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

let mediaListenerAttached = false;

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: "system",
  resolved: resolveSystemTheme(),
  setMode: (mode) => {
    const resolved = resolve(mode);
    set({ mode, resolved });
    applyTheme(resolved);
    void settingsSet("theme", mode).catch(() => {});
  },
  toggle: () => {
    const { mode, resolved } = get();
    // From "system", flip to the opposite of the currently-resolved kind so the
    // first toggle is visible. From explicit, swap light <-> dark.
    const next: ThemeMode = mode === "system"
      ? (resolved.kind === "dark" ? "light" : "dark")
      : (mode === "dark" ? "light" : "dark");
    get().setMode(next);
  },
  load: async () => {
    let mode: ThemeMode = "system";
    try {
      const stored = await settingsGet<string>("theme");
      if (isValidMode(stored)) {
        mode = stored;
      } else {
        // Migrate any legacy theme id ("void", "dracula", etc.) to "system".
        await settingsSet("theme", "system").catch(() => {});
      }
    } catch {
      // Settings unavailable — fall through with "system" default.
    }

    if (!mediaListenerAttached && typeof window !== "undefined" && window.matchMedia) {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (get().mode === "system") {
          const r = resolveSystemTheme();
          set({ resolved: r });
          applyTheme(r);
        }
      };
      mql.addEventListener?.("change", onChange);
      mediaListenerAttached = true;
    }

    const resolved = resolve(mode);
    set({ mode, resolved });
    applyTheme(resolved);
  },
}));
