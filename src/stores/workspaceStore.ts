import { create } from "zustand";
import type { LayoutNode, Pane, PaneKind, Tab } from "../lib/types";
import { settingsGet, settingsSet, type SpawnProgram } from "../lib/tauri";

const newId = () => Math.random().toString(36).slice(2, 10);

const TAB_COLORS = ["#7c5cff", "#5cc8ff", "#2ee29a", "#f7b955", "#ef4f6f", "#c98aff"];

const emptyPane = (kind: PaneKind = "terminal"): Pane => ({
  id: newId(),
  kind,
  payload: {},
});

const leaf = (paneId: string): LayoutNode => ({ type: "leaf", paneId });

function buildLayout(paneCount: number, paneIds: string[]): LayoutNode {
  // Layout heuristics for 1, 2, 4, 6, 8, 9, 12, 16
  if (paneCount === 1) return leaf(paneIds[0]);
  if (paneCount === 2) {
    return {
      type: "split",
      direction: "horizontal",
      sizes: [50, 50],
      children: [leaf(paneIds[0]), leaf(paneIds[1])],
    };
  }
  if (paneCount === 4) {
    return {
      type: "split",
      direction: "vertical",
      sizes: [50, 50],
      children: [
        {
          type: "split",
          direction: "horizontal",
          sizes: [50, 50],
          children: [leaf(paneIds[0]), leaf(paneIds[1])],
        },
        {
          type: "split",
          direction: "horizontal",
          sizes: [50, 50],
          children: [leaf(paneIds[2]), leaf(paneIds[3])],
        },
      ],
    };
  }
  // 6 = 2 rows of 3
  if (paneCount === 6) {
    const row = (a: string, b: string, c: string): LayoutNode => ({
      type: "split",
      direction: "horizontal",
      sizes: [33.34, 33.33, 33.33],
      children: [leaf(a), leaf(b), leaf(c)],
    });
    return {
      type: "split",
      direction: "vertical",
      sizes: [50, 50],
      children: [
        row(paneIds[0], paneIds[1], paneIds[2]),
        row(paneIds[3], paneIds[4], paneIds[5]),
      ],
    };
  }
  // 8 = 2 rows of 4
  if (paneCount === 8) {
    const row = (ids: string[]): LayoutNode => ({
      type: "split",
      direction: "horizontal",
      sizes: [25, 25, 25, 25],
      children: ids.map(leaf),
    });
    return {
      type: "split",
      direction: "vertical",
      sizes: [50, 50],
      children: [row(paneIds.slice(0, 4)), row(paneIds.slice(4, 8))],
    };
  }
  // 9 = 3x3
  if (paneCount === 9) {
    const row = (ids: string[]): LayoutNode => ({
      type: "split",
      direction: "horizontal",
      sizes: [33.34, 33.33, 33.33],
      children: ids.map(leaf),
    });
    return {
      type: "split",
      direction: "vertical",
      sizes: [33.34, 33.33, 33.33],
      children: [row(paneIds.slice(0, 3)), row(paneIds.slice(3, 6)), row(paneIds.slice(6, 9))],
    };
  }
  // 12 = 3 rows of 4
  if (paneCount === 12) {
    const row = (ids: string[]): LayoutNode => ({
      type: "split",
      direction: "horizontal",
      sizes: [25, 25, 25, 25],
      children: ids.map(leaf),
    });
    return {
      type: "split",
      direction: "vertical",
      sizes: [33.34, 33.33, 33.33],
      children: [
        row(paneIds.slice(0, 4)),
        row(paneIds.slice(4, 8)),
        row(paneIds.slice(8, 12)),
      ],
    };
  }
  // 16 = 4x4
  if (paneCount === 16) {
    const row = (ids: string[]): LayoutNode => ({
      type: "split",
      direction: "horizontal",
      sizes: [25, 25, 25, 25],
      children: ids.map(leaf),
    });
    return {
      type: "split",
      direction: "vertical",
      sizes: [25, 25, 25, 25],
      children: [
        row(paneIds.slice(0, 4)),
        row(paneIds.slice(4, 8)),
        row(paneIds.slice(8, 12)),
        row(paneIds.slice(12, 16)),
      ],
    };
  }
  // Fallback: single column
  return {
    type: "split",
    direction: "vertical",
    sizes: paneIds.map(() => 100 / paneIds.length),
    children: paneIds.map(leaf),
  };
}

export type DropEdge = "top" | "right" | "bottom" | "left";

export type PanePreset = {
  kind?: PaneKind;
  pendingCommand?: string;
  spawnEnv?: Record<string, string>;
  spawnCwd?: string;
  title?: string;
  // Preview-only seeds: PreviewPane reads payload.url / payload.projectPath
  // (the latter triggers auto-detect of a Vite/Next/etc dev server).
  url?: string;
  projectPath?: string;
  // SSH-only seeds: linking a terminal pane to a stored SshHost. spawnProgram
  // is the {cmd, args} pair pty_spawn uses to override the default shell —
  // re-derived from the host record on every resume so edits propagate.
  sshHostId?: string;
  spawnProgram?: SpawnProgram;
};

function presetToPayload(preset: PanePreset): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    pendingCommand: preset.pendingCommand,
    spawnEnv: preset.spawnEnv,
    spawnCwd: preset.spawnCwd,
    title: preset.title,
  };
  if (preset.kind === "preview") {
    if (preset.url !== undefined) payload.url = preset.url;
    if (preset.projectPath !== undefined) payload.projectPath = preset.projectPath;
  }
  if (preset.sshHostId !== undefined) payload.sshHostId = preset.sshHostId;
  if (preset.spawnProgram !== undefined) payload.spawnProgram = preset.spawnProgram;
  return payload;
}

type WorkspaceState = {
  tabs: Tab[];
  activeTabId: string | null;
  selectedView: "workspace" | "kanban" | "knowledge" | "agents" | "ssh" | "settings";
  hydrated: boolean;

  setView: (view: WorkspaceState["selectedView"]) => void;
  hydrate: () => Promise<void>;

  newTab: (template: number, name?: string, presets?: PanePreset[], projectPath?: string) => string;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  switchToTabIndex: (i: number) => void;
  renameTab: (id: string, name: string) => void;

  setTabProjectPath: (tabId: string, path: string | undefined) => void;
  setActivePane: (tabId: string, paneId: string) => void;
  togglePaneSelection: (tabId: string, paneId: string) => void;
  clearPaneSelection: (tabId: string) => void;
  replacePaneSelection: (tabId: string, ids: string[]) => void;
  setPaneKind: (tabId: string, paneId: string, kind: PaneKind, payload?: Record<string, unknown>) => void;
  setPanePayload: (tabId: string, paneId: string, payload: Record<string, unknown>) => void;
  splitPane: (
    tabId: string,
    paneId: string,
    direction: "horizontal" | "vertical",
    preset?: PanePreset,
  ) => void;
  closePane: (tabId: string, paneId: string) => void;
  swapPanes: (tabId: string, paneIdA: string, paneIdB: string) => void;
  movePaneToEdge: (tabId: string, sourceId: string, targetId: string, edge: DropEdge) => void;

  setLayoutSizes: (tabId: string, path: number[], sizes: number[]) => void;
};

function findAndMutateLayout(
  layout: LayoutNode,
  predicate: (n: LayoutNode) => boolean,
  mutate: (n: LayoutNode, parent: LayoutNode | null, indexInParent: number) => LayoutNode,
  parent: LayoutNode | null = null,
  index = 0,
): LayoutNode {
  if (predicate(layout)) {
    return mutate(layout, parent, index);
  }
  if (layout.type === "split") {
    return {
      ...layout,
      children: layout.children.map((c, i) =>
        findAndMutateLayout(c, predicate, mutate, layout, i),
      ),
    };
  }
  return layout;
}

function removeLeaf(layout: LayoutNode, paneId: string): LayoutNode | null {
  if (layout.type === "leaf") {
    return layout.paneId === paneId ? null : layout;
  }
  const newChildren: LayoutNode[] = [];
  const newSizes: number[] = [];
  layout.children.forEach((child, i) => {
    const result = removeLeaf(child, paneId);
    if (result) {
      newChildren.push(result);
      newSizes.push(layout.sizes[i]);
    }
  });
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  // Renormalize sizes
  const total = newSizes.reduce((a, b) => a + b, 0);
  const normalized = newSizes.map((s) => (s / total) * 100);
  return { ...layout, children: newChildren, sizes: normalized };
}

function swapLeavesInLayout(layout: LayoutNode, idA: string, idB: string): LayoutNode {
  if (layout.type === "leaf") {
    if (layout.paneId === idA) return { type: "leaf", paneId: idB };
    if (layout.paneId === idB) return { type: "leaf", paneId: idA };
    return layout;
  }
  return { ...layout, children: layout.children.map((c) => swapLeavesInLayout(c, idA, idB)) };
}

function movePaneToEdgeInLayout(
  layout: LayoutNode,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): LayoutNode | null {
  const stripped = removeLeaf(layout, sourceId);
  if (!stripped) return null;
  const direction: "horizontal" | "vertical" =
    edge === "top" || edge === "bottom" ? "vertical" : "horizontal";
  const sourceFirst = edge === "top" || edge === "left";
  return findAndMutateLayout(
    stripped,
    (n) => n.type === "leaf" && n.paneId === targetId,
    (n) => ({
      type: "split",
      direction,
      sizes: [50, 50],
      children: sourceFirst
        ? [{ type: "leaf", paneId: sourceId }, n]
        : [n, { type: "leaf", paneId: sourceId }],
    }),
  );
}

function setSizesAtPath(layout: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (path.length === 0) {
    if (layout.type === "split") return { ...layout, sizes };
    return layout;
  }
  if (layout.type !== "split") return layout;
  const [head, ...rest] = path;
  return {
    ...layout,
    children: layout.children.map((c, i) => (i === head ? setSizesAtPath(c, rest, sizes) : c)),
  };
}

function makeTab(
  name: string,
  template: number,
  presets: PanePreset[] = [],
  projectPath?: string,
): Tab {
  const count = template;
  const ids = Array.from({ length: count }, () => newId());
  const panes = ids.reduce<Record<string, Pane>>((acc, id, i) => {
    const preset = presets[i];
    acc[id] = {
      id,
      kind: preset?.kind ?? "terminal",
      payload: preset ? presetToPayload(preset) : {},
    };
    return acc;
  }, {});
  const layout = buildLayout(count, ids);
  return {
    id: newId(),
    name,
    color: TAB_COLORS[Math.floor(Math.random() * TAB_COLORS.length)],
    layout,
    panes,
    activePaneId: ids[0],
    selectedPaneIds: [],
    projectPath: projectPath || undefined,
  };
}

const PERSIST_KEY = "workspaceSnapshot";

type Snapshot = { tabs: Tab[]; activeTabId: string | null };

// Strip ephemeral session refs from payload before persisting — old session IDs
// are stale across launches and would confuse the terminal pane.
const EPHEMERAL_KEYS = new Set([
  "sessionId",
  "pendingCommand",
  "pickerActive",
  "connectionId",
  "logsChannelId",
  // SSH: sshHostId stays; the derived command line + the dead-PTY flag +
  // the reconnect counter are recomputed on resume from the live host
  // record (or default to fresh values).
  "spawnProgram",
  "sshExited",
  "sshAttempt",
]);
function stripEphemeral(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!payload) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (!EPHEMERAL_KEYS.has(k)) out[k] = v;
  }
  return out;
}
function snapshot(state: WorkspaceState): Snapshot {
  const tabs = state.tabs.map((t) => ({
    ...t,
    panes: Object.fromEntries(
      Object.entries(t.panes).map(([id, p]) => [id, { ...p, payload: stripEphemeral(p.payload) }]),
    ),
    // selection is ephemeral — never persist
    selectedPaneIds: [],
  }));
  return { tabs, activeTabId: state.activeTabId };
}

let saveTimer: number | undefined;
function persist(state: WorkspaceState) {
  if (!state.hydrated) return;
  if (saveTimer !== undefined) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void settingsSet(PERSIST_KEY, snapshot(state)).catch(() => {});
  }, 400);
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  selectedView: "workspace",
  hydrated: false,
  setView: (view) => set({ selectedView: view }),
  hydrate: async () => {
    try {
      const snap = await settingsGet<Snapshot>(PERSIST_KEY);
      if (snap && snap.tabs && snap.tabs.length > 0) {
        const tabs = snap.tabs.map((t) => {
          // Migrate snapshots from before Tab.projectPath existed: the project
          // folder used to live on individual panes (filebrowser.payload.root,
          // terminal.payload.spawnCwd, preview.payload.projectPath). Lift the
          // first match onto the tab so splits and Cmd+T inherit it.
          let projectPath = t.projectPath;
          if (!projectPath) {
            for (const p of Object.values(t.panes)) {
              const payload = p.payload as Record<string, unknown> | undefined;
              const candidate =
                p.kind === "filebrowser" ? payload?.root :
                p.kind === "terminal" ? payload?.spawnCwd :
                p.kind === "preview" ? payload?.projectPath :
                undefined;
              if (typeof candidate === "string" && candidate) {
                projectPath = candidate;
                break;
              }
            }
          }
          return { ...t, selectedPaneIds: [], projectPath };
        });
        set({ tabs, activeTabId: snap.activeTabId ?? tabs[0].id, hydrated: true });
        return;
      }
    } catch {
      // fall through to default
    }
    set({ hydrated: true });
  },
  newTab: (template, name, presets, projectPath) => {
    const idx = get().tabs.length + 1;
    const tab = makeTab(name ?? `workspace ${idx}`, template, presets, projectPath);
    set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id, selectedView: "workspace" }));
    return tab.id;
  },
  closeTab: (id) => {
    set((s) => {
      const remaining = s.tabs.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        return { tabs: [], activeTabId: null };
      }
      const newActive =
        s.activeTabId === id ? remaining[remaining.length - 1].id : s.activeTabId;
      return { tabs: remaining, activeTabId: newActive };
    });
  },
  setActiveTab: (id) => set({ activeTabId: id, selectedView: "workspace" }),
  switchToTabIndex: (i) => {
    const t = get().tabs[i];
    if (t) get().setActiveTab(t.id);
  },
  renameTab: (id, name) =>
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, name } : t)) })),

  setTabProjectPath: (tabId, path) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, projectPath: path || undefined } : t)),
    })),

  setActivePane: (tabId, paneId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, activePaneId: paneId } : t)),
    })),

  togglePaneSelection: (tabId, paneId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const current = t.selectedPaneIds ?? [];
        const has = current.includes(paneId);
        let next: string[];
        if (has) {
          next = current.filter((id) => id !== paneId);
          // A 1-element selection is a ghost: it can't broadcast (needs ≥2)
          // but still draws a badge. Collapse to empty for clarity.
          if (next.length < 2) next = [];
        } else {
          // Implicitly include the active pane so it remains a broadcast member
          // once another pane is multi-selected. Both adds are guarded so the
          // active-equals-clicked case doesn't double-push.
          next = [...current];
          if (t.activePaneId && !next.includes(t.activePaneId)) next.push(t.activePaneId);
          if (!next.includes(paneId)) next.push(paneId);
        }
        return { ...t, selectedPaneIds: next, activePaneId: has ? t.activePaneId : paneId };
      }),
    })),

  clearPaneSelection: (tabId) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, selectedPaneIds: [] } : t)),
    })),

  replacePaneSelection: (tabId, ids) =>
    set((s) => ({
      tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, selectedPaneIds: ids } : t)),
    })),

  setPaneKind: (tabId, paneId, kind, payload) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              panes: {
                ...t.panes,
                [paneId]: {
                  ...t.panes[paneId],
                  kind,
                  payload: payload ?? t.panes[paneId].payload,
                },
              },
            }
          : t,
      ),
    })),

  setPanePayload: (tabId, paneId, payload) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? {
              ...t,
              panes: {
                ...t.panes,
                [paneId]: { ...t.panes[paneId], payload: { ...t.panes[paneId].payload, ...payload } },
              },
            }
          : t,
      ),
    })),

  splitPane: (tabId, paneId, direction, preset) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const newPane = emptyPane(preset?.kind ?? "terminal");
        if (preset) {
          newPane.payload = presetToPayload(preset);
        }
        const newLayout = findAndMutateLayout(
          t.layout,
          (n) => n.type === "leaf" && n.paneId === paneId,
          (n) => ({
            type: "split",
            direction,
            sizes: [50, 50],
            children: [n, leaf(newPane.id)],
          }),
        );
        return {
          ...t,
          panes: { ...t.panes, [newPane.id]: newPane },
          layout: newLayout,
          activePaneId: newPane.id,
        };
      }),
    }));
  },

  closePane: (tabId, paneId) => {
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const stripped = removeLeaf(t.layout, paneId);
        const { [paneId]: _, ...remaining } = t.panes;
        const prunedSelection = (t.selectedPaneIds ?? []).filter((id) => id !== paneId);
        if (!stripped) {
          // Last pane closed: create a fresh one to keep the tab alive.
          const p = emptyPane("terminal");
          return {
            ...t,
            layout: leaf(p.id),
            panes: { [p.id]: p },
            activePaneId: p.id,
            selectedPaneIds: [],
          };
        }
        const firstRemaining = Object.keys(remaining)[0];
        return {
          ...t,
          layout: stripped,
          panes: remaining,
          activePaneId: t.activePaneId === paneId ? firstRemaining : t.activePaneId,
          selectedPaneIds: prunedSelection,
        };
      }),
    }));
  },

  swapPanes: (tabId, paneIdA, paneIdB) => {
    if (paneIdA === paneIdB) return;
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId
          ? { ...t, layout: swapLeavesInLayout(t.layout, paneIdA, paneIdB) }
          : t,
      ),
    }));
  },

  movePaneToEdge: (tabId, sourceId, targetId, edge) => {
    if (sourceId === targetId) return;
    set((s) => ({
      tabs: s.tabs.map((t) => {
        if (t.id !== tabId) return t;
        const next = movePaneToEdgeInLayout(t.layout, sourceId, targetId, edge);
        if (!next) return t;
        return { ...t, layout: next, activePaneId: sourceId };
      }),
    }));
  },

  setLayoutSizes: (tabId, path, sizes) =>
    set((s) => ({
      tabs: s.tabs.map((t) =>
        t.id === tabId ? { ...t, layout: setSizesAtPath(t.layout, path, sizes) } : t,
      ),
    })),
}));

// Persist tabs/activeTabId on every change once the store has hydrated.
// The persist() helper already debounces (400ms), so calling on every set is fine.
useWorkspaceStore.subscribe((state) => {
  if (state.hydrated) persist(state);
});

export const TEMPLATES = [
  {
    id: 1,
    label: "Solo",
    panes: 1,
    description: "One pane — quick shell or single-agent run.",
  },
  {
    id: 2,
    label: "Pair",
    panes: 2,
    description: "Side-by-side — agent + reviewer, or terminal + editor.",
  },
  {
    id: 4,
    label: "Quad",
    panes: 4,
    description: "2×2 dashboard — multiple agents or terminal/editor/preview/files.",
  },
  {
    id: 6,
    label: "Squad",
    panes: 6,
    description: "Two rows of three — small team workspace.",
  },
  {
    id: 8,
    label: "Pipeline",
    panes: 8,
    description: "Two rows of four — parallel pipeline runs.",
  },
  {
    id: 9,
    label: "Grid 3×3",
    panes: 9,
    description: "Nine equal panes — broad observation board.",
  },
  {
    id: 12,
    label: "Wide grid",
    panes: 12,
    description: "Three rows of four — heavy parallel workload.",
  },
  {
    id: 16,
    label: "Mega grid",
    panes: 16,
    description: "4×4 — maximum density. Reduces per-pane width significantly.",
  },
];
