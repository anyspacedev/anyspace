import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";

export type ProxyMode = "off" | "manual";

export type ProxySettings = {
  mode: ProxyMode;
  // Single-URL form: applied to every scheme. Used when httpUrl/httpsUrl are empty.
  url: string;
  // Per-scheme overrides. If either is set, `url` is ignored.
  httpUrl: string;
  httpsUrl: string;
  // Comma-separated host/CIDR exclusions. localhost/127.0.0.1/::1 are always
  // excluded by the backend regardless of this list.
  noProxy: string;
};

const DEFAULT_SETTINGS: ProxySettings = {
  mode: "off",
  url: "",
  httpUrl: "",
  httpsUrl: "",
  noProxy: "",
};

const SETTINGS_KEY = "proxy";

type ProxyState = {
  settings: ProxySettings;
  loaded: boolean;
  load: () => Promise<void>;
  updateSettings: (partial: Partial<ProxySettings>) => Promise<void>;
};

export const useProxyStore = create<ProxyState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const stored = await settingsGet<Partial<ProxySettings>>(SETTINGS_KEY);
      if (stored) {
        set({ settings: { ...DEFAULT_SETTINGS, ...stored }, loaded: true });
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  updateSettings: async (partial) => {
    const next = { ...get().settings, ...partial };
    set({ settings: next });
    try {
      await settingsSet(SETTINGS_KEY, next);
    } catch {
      /* best-effort persistence */
    }
  },
}));
