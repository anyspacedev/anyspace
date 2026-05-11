import { create } from "zustand";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  knowledgeGraph,
  knowledgeList,
  knowledgeProjectHash,
  knowledgeWatchStart,
  knowledgeWatchStop,
  type KnowledgeGraph,
  type NoteSummary,
} from "../lib/knowledge";
import { settingsGet, settingsSet } from "../lib/tauri";

type KnowledgeState = {
  loaded: boolean;
  activeProjectPath: string | null;
  notes: NoteSummary[];
  graph: KnowledgeGraph | null;
  /** Backlinks panel collapsed state — persisted across restarts. */
  backlinksPanelOpen: boolean;
  /** Currently-open note slug in the center editor. */
  activeSlug: string | null;
  /** Last edited slug to scroll-into-view after a reload. */
  pendingFocusSlug: string | null;

  load: () => Promise<void>;
  setProject: (path: string | null) => Promise<void>;
  reload: () => Promise<void>;
  setActiveSlug: (slug: string | null) => void;
  toggleBacklinksPanel: () => Promise<void>;
};

const SETTINGS_KEY = "knowledge";

type StoredSettings = {
  backlinksPanelOpen: boolean;
  lastProjectPath: string | null;
};

const DEFAULT_STORED: StoredSettings = {
  backlinksPanelOpen: true,
  lastProjectPath: null,
};

async function persistSettings(get: () => KnowledgeState): Promise<void> {
  const s = get();
  try {
    await settingsSet(SETTINGS_KEY, {
      backlinksPanelOpen: s.backlinksPanelOpen,
      lastProjectPath: s.activeProjectPath,
    });
  } catch {
    /* best-effort */
  }
}

// Module-scoped so we can drop them when switching projects.
let currentUnlisten: UnlistenFn | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | null = null;

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  loaded: false,
  activeProjectPath: null,
  notes: [],
  graph: null,
  backlinksPanelOpen: DEFAULT_STORED.backlinksPanelOpen,
  activeSlug: null,
  pendingFocusSlug: null,

  load: async () => {
    try {
      const stored = await settingsGet<Partial<StoredSettings>>(SETTINGS_KEY);
      if (stored) {
        set({
          backlinksPanelOpen:
            typeof stored.backlinksPanelOpen === "boolean"
              ? stored.backlinksPanelOpen
              : DEFAULT_STORED.backlinksPanelOpen,
          loaded: true,
        });
        // Restore the last project lazily — setProject starts a watcher, so
        // we run it after the initial state is in place.
        if (stored.lastProjectPath) {
          void get().setProject(stored.lastProjectPath);
        }
      } else {
        set({ loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  setProject: async (path) => {
    const prev = get().activeProjectPath;
    if (prev === path) return;

    // Tear down any previous watcher subscription.
    if (currentUnlisten) {
      currentUnlisten();
      currentUnlisten = null;
    }
    if (reloadTimer) {
      clearTimeout(reloadTimer);
      reloadTimer = null;
    }
    if (prev) {
      try {
        await knowledgeWatchStop(prev);
      } catch {
        /* best-effort */
      }
    }

    set({ activeProjectPath: path, notes: [], graph: null, activeSlug: null });
    void persistSettings(get);

    if (!path) return;

    try {
      const hash = await knowledgeProjectHash(path);
      await knowledgeWatchStart(path);
      const unlisten = await listen(`knowledge:changed:${hash}`, () => {
        // Debounce — multiple file events fire in a burst on save.
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          void get().reload();
        }, 200);
      });
      currentUnlisten = unlisten;
      await get().reload();
    } catch (e) {
      console.warn("[knowledge] setProject failed", path, e);
    }
  },

  reload: async () => {
    const path = get().activeProjectPath;
    if (!path) return;
    try {
      const [notes, graph] = await Promise.all([
        knowledgeList(path),
        knowledgeGraph(path),
      ]);
      set({ notes, graph });
    } catch (e) {
      console.warn("[knowledge] reload failed", path, e);
    }
  },

  setActiveSlug: (slug) => {
    set({ activeSlug: slug });
  },

  toggleBacklinksPanel: async () => {
    const next = !get().backlinksPanelOpen;
    set({ backlinksPanelOpen: next });
    await persistSettings(get);
  },
}));
