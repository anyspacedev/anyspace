import { create } from "zustand";
import { settingsGet, settingsSet, sshPasswordDelete } from "../lib/tauri";

export type SshHost = {
  id: string;
  name: string;
  host: string;
  user?: string;
  port?: number;
  /** Auth strategy. `"key"` (default) uses the system ssh agent + identity
   *  file. `"password"` reads from the OS keychain at connect time. The
   *  password itself is NEVER stored in this object or in settings.json. */
  authMethod?: "key" | "password";
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
    const prev = existing >= 0 ? list[existing] : undefined;
    const hosts = existing >= 0
      ? list.map((h, i) => (i === existing ? next : h))
      : [...list, next];
    set({ hosts });
    try {
      await settingsSet(SETTINGS_KEY, { hosts });
    } catch {
      /* best-effort persistence */
    }
    // If the user just flipped from password → key auth, clear the
    // keychain entry so a stale password doesn't get reused if they flip
    // back. (The form is also responsible for this on save, but doing it
    // here is cheap insurance.)
    if (prev?.authMethod === "password" && next.authMethod !== "password") {
      try {
        await sshPasswordDelete(id);
      } catch {
        /* keychain may be locked or unavailable — non-fatal */
      }
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
    // Always attempt to clear the keychain — even if the host was on key
    // auth, an old password entry from an earlier mode shouldn't outlive
    // the host.
    try {
      await sshPasswordDelete(id);
    } catch {
      /* keychain may be locked or unavailable — non-fatal */
    }
  },
}));
