/**
 * Background watcher observation builder.
 *
 * Each tick assembles a structured snapshot of "what's in the window right
 * now" plus a human-readable delta list since the last tick. The snapshot
 * is JSON-serialized and fed to the background SA session as a user message.
 *
 * Caps:
 *  - serialized payload ≤ 12 KB (drop oldest deltas / truncate screen tails)
 *  - per-pane screenTail ≤ 60 lines
 *  - kanban excludes "complete" column (noise)
 *  - deltas ≤ 20 entries
 */

import { useKanbanStore } from "../../stores/kanbanStore";
import { useTeamStore } from "../../stores/teamStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { getTerminalScreen } from "../../components/terminal/terminalRegistry";
import type { Pane, Task } from "../types";

const MAX_PAYLOAD_BYTES = 12 * 1024;
const SCREEN_TAIL_ROWS = 60;
const MAX_DELTAS = 20;

export type ObservationTrigger = "heartbeat" | "kanban" | "workspace";

export type ObservedPane = {
  paneId: string;
  kind: string;
  taskId?: string;
  title?: string;
  lastCommand?: string;
  lastExitCode?: number;
  screenTail?: string;
};

export type ObservedKanbanTask = {
  id: string;
  title: string;
  column: Task["column"];
  agentId?: string;
};

export type ObservedTab = { id: string; name: string; paneIds: string[] };

export type ObservedTeam = {
  id: string;
  name: string;
  status: string;
  agents: number;
};

export type Observation = {
  ts: number;
  trigger: ObservationTrigger;
  tabs: ObservedTab[];
  panes: ObservedPane[];
  kanban: ObservedKanbanTask[];
  teams: ObservedTeam[];
  deltas: string[];
};

/** Internal — last seen state, used to derive `deltas`. */
type WatcherMemory = {
  ts: number;
  tabIds: Set<string>;
  paneIds: Set<string>;
  kanbanCols: Map<string, Task["column"]>;
  teamIds: Set<string>;
};

let memory: WatcherMemory | null = null;

export function buildObservation(trigger: ObservationTrigger): Observation {
  const ws = useWorkspaceStore.getState();
  const kanban = useKanbanStore.getState();
  const teams = useTeamStore.getState();

  const tabs: ObservedTab[] = ws.tabs.map((t) => ({
    id: t.id,
    name: t.name,
    paneIds: Object.keys(t.panes),
  }));

  const panes: ObservedPane[] = [];
  for (const tab of ws.tabs) {
    for (const pane of Object.values(tab.panes)) {
      panes.push(snapshotPane(pane, tab.name));
    }
  }

  const kanbanTasks: ObservedKanbanTask[] = kanban.tasks
    .filter((t) => t.column !== "complete")
    .map((t) => ({
      id: t.id,
      title: t.title,
      column: t.column,
      agentId: t.agentId,
    }));

  const teamsObserved: ObservedTeam[] = teams.teams.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    agents: (teams.agents[t.id] ?? []).length,
  }));

  const deltas = computeDeltas(tabs, panes, kanbanTasks, teamsObserved);

  let obs: Observation = {
    ts: Date.now(),
    trigger,
    tabs,
    panes,
    kanban: kanbanTasks,
    teams: teamsObserved,
    deltas,
  };

  obs = enforcePayloadCap(obs);
  rememberState(obs);
  return obs;
}

/** Quickly compare the serialized obs to the previous one — used by the
 *  ticker to skip ticks when nothing meaningful has changed. */
let lastSerialized: string | null = null;
export function diffsSinceLastTick(obs: Observation): boolean {
  const next = JSON.stringify({
    tabs: obs.tabs,
    panes: obs.panes.map((p) => ({ ...p, screenTail: undefined })),
    kanban: obs.kanban,
    teams: obs.teams,
  });
  if (next === lastSerialized) return false;
  lastSerialized = next;
  return true;
}

function snapshotPane(pane: Pane, tabName: string): ObservedPane {
  const env = (pane.payload?.spawnEnv as Record<string, string> | undefined) ?? undefined;
  const taskId = env?.ANYSPACE_TASK_ID || undefined;
  const title =
    (pane.payload?.title as string | undefined) ||
    (pane.payload?.filePath as string | undefined) ||
    tabName;

  const base: ObservedPane = { paneId: pane.id, kind: pane.kind, title };
  if (taskId) base.taskId = taskId;

  if (pane.kind === "terminal") {
    const screen = getTerminalScreen(pane.id, SCREEN_TAIL_ROWS);
    if (screen) {
      base.lastCommand = screen.lastCommand ?? undefined;
      base.lastExitCode = screen.lastExitCode ?? undefined;
      base.screenTail = screen.screen;
    }
  }
  return base;
}

function computeDeltas(
  tabs: ObservedTab[],
  panes: ObservedPane[],
  kanbanTasks: ObservedKanbanTask[],
  teams: ObservedTeam[],
): string[] {
  if (!memory) return [];
  const deltas: string[] = [];

  const tabIds = new Set(tabs.map((t) => t.id));
  for (const id of memory.tabIds) {
    if (!tabIds.has(id)) deltas.push(`tab ${id} closed`);
  }
  for (const id of tabIds) {
    if (!memory.tabIds.has(id)) deltas.push(`tab ${id} opened`);
  }

  const paneIds = new Set(panes.map((p) => p.paneId));
  for (const id of memory.paneIds) {
    if (!paneIds.has(id)) deltas.push(`pane ${id.slice(0, 6)} closed`);
  }
  for (const id of paneIds) {
    if (!memory.paneIds.has(id)) deltas.push(`pane ${id.slice(0, 6)} opened`);
  }

  for (const t of kanbanTasks) {
    const prev = memory.kanbanCols.get(t.id);
    if (prev && prev !== t.column) {
      deltas.push(`task "${t.title}" moved ${prev} → ${t.column}`);
    } else if (!prev) {
      deltas.push(`task "${t.title}" created (${t.column})`);
    }
  }

  const teamIds = new Set(teams.map((t) => t.id));
  for (const id of memory.teamIds) {
    if (!teamIds.has(id)) deltas.push(`team ${id} ended`);
  }
  for (const id of teamIds) {
    if (!memory.teamIds.has(id)) deltas.push(`team ${id} started`);
  }

  return deltas.slice(-MAX_DELTAS);
}

function rememberState(obs: Observation): void {
  memory = {
    ts: obs.ts,
    tabIds: new Set(obs.tabs.map((t) => t.id)),
    paneIds: new Set(obs.panes.map((p) => p.paneId)),
    kanbanCols: new Map(obs.kanban.map((t) => [t.id, t.column])),
    teamIds: new Set(obs.teams.map((t) => t.id)),
  };
}

function enforcePayloadCap(obs: Observation): Observation {
  let serialized = JSON.stringify(obs);
  if (serialized.length <= MAX_PAYLOAD_BYTES) return obs;

  // Step 1: drop oldest deltas.
  let next = { ...obs, deltas: obs.deltas.slice(-10) };
  serialized = JSON.stringify(next);
  if (serialized.length <= MAX_PAYLOAD_BYTES) return next;

  // Step 2: shorten screen tails progressively.
  const tailCaps = [40, 25, 12, 6];
  for (const cap of tailCaps) {
    next = {
      ...next,
      panes: next.panes.map((p) =>
        p.screenTail
          ? { ...p, screenTail: trimScreenTail(p.screenTail, cap) }
          : p,
      ),
    };
    serialized = JSON.stringify(next);
    if (serialized.length <= MAX_PAYLOAD_BYTES) return next;
  }

  // Step 3: drop screen tails entirely.
  next = {
    ...next,
    panes: next.panes.map((p) => ({ ...p, screenTail: undefined })),
  };
  return next;
}

function trimScreenTail(text: string, rows: number): string {
  const lines = text.split("\n");
  if (lines.length <= rows) return text;
  return lines.slice(lines.length - rows).join("\n");
}

export function resetWatcherMemory(): void {
  memory = null;
  lastSerialized = null;
}
