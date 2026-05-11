import { create } from "zustand";
import { settingsGet, settingsSet } from "../lib/tauri";

export type SshHost = {
  id: string;
  name: string;
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
  jumpHost?: string;
  defaultDirectory?: string;
  env?: Record<string, string>;
};

type StoredShape = { hosts: SshHost[] };

const DEFAULT: StoredShape = { hosts: [] };
const SETTINGS_KEY = "ssh";

const newId = () => Math.random().toString(36).slice(2, 10);

type SshHostsState = {
  hosts: SshHost[];
  loaded: boolean;
  load: () => Promise<void>;
  upsertHost: (host: SshHost) => Promise<SshHost>;
  removeHost: (id: string) => Promise<void>;
};

export const useSshHostsStore = create<SshHostsState>((set, get) => ({
  hosts: [],
  loaded: false,

  load: async () => {
    try {
      const stored = await settingsGet<Partial<StoredShape>>(SETTINGS_KEY);
      const hosts = Array.isArray(stored?.hosts) ? (stored!.hosts as SshHost[]) : DEFAULT.hosts;
      set({ hosts, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  upsertHost: async (host) => {
    const id = host.id || newId();
    const next = { ...host, id };
    const list = get().hosts;
    const existing = list.findIndex((h) => h.id === id);
    const hosts = existing >= 0
      ? list.map((h, i) => (i === existing ? next : h))
      : [...list, next];
    set({ hosts });
    try {
      await settingsSet(SETTINGS_KEY, { hosts });
    } catch {
      /* best-effort persistence */
    }
    return next;
  },

  removeHost: async (id) => {
    const hosts = get().hosts.filter((h) => h.id !== id);
    set({ hosts });
    try {
      await settingsSet(SETTINGS_KEY, { hosts });
    } catch {
      /* best-effort persistence */
    }
  },
}));
