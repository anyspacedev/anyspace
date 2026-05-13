import { describe, expect, it, beforeEach, vi } from "vitest";

import {
  buildObservation,
  resetWatcherMemory,
} from "../src/lib/backgroundWatcher/observation";
import { useKanbanStore } from "../src/stores/kanbanStore";
import { useWorkspaceStore } from "../src/stores/workspaceStore";
import { useTeamStore } from "../src/stores/teamStore";
import type { Pane, Task } from "../src/lib/types";

// Mock the terminal registry so observation can pull deterministic "screen
// tails" without spinning up xterm.
vi.mock("../src/components/terminal/terminalRegistry", () => ({
  getTerminalScreen: (paneId: string) => ({
    bufferType: "normal" as const,
    screen: `[pane ${paneId}] line 1\n[pane ${paneId}] line 2`,
    lastCommand: "echo hi",
    lastExitCode: 0,
    lastBlockState: "finished" as const,
    sessionId: paneId,
  }),
}));

const baseTab = (id: string, panes: Pane[]) => ({
  id,
  name: `Tab ${id}`,
  layout: { type: "leaf" as const, paneId: panes[0].id },
  panes: Object.fromEntries(panes.map((p) => [p.id, p])),
});

beforeEach(() => {
  resetWatcherMemory();
  useWorkspaceStore.setState({ tabs: [], activeTabId: null } as Parameters<
    typeof useWorkspaceStore.setState
  >[0]);
  useKanbanStore.setState({ tasks: [], agents: [] } as Parameters<
    typeof useKanbanStore.setState
  >[0]);
  useTeamStore.setState({ teams: [], agents: {} } as Parameters<
    typeof useTeamStore.setState
  >[0]);
});

describe("observation builder", () => {
  it("excludes 'complete' kanban tasks", () => {
    const tasks: Task[] = [
      { id: "a", title: "open", body: "", column: "todo", ordinal: 1, createdAt: 0, updatedAt: 0 },
      { id: "b", title: "done", body: "", column: "complete", ordinal: 2, createdAt: 0, updatedAt: 0 },
    ];
    useKanbanStore.setState({ tasks } as Parameters<
      typeof useKanbanStore.setState
    >[0]);
    const obs = buildObservation("heartbeat");
    expect(obs.kanban.map((t) => t.id)).toEqual(["a"]);
  });

  it("captures terminal screen tail and last command for terminal panes", () => {
    const pane: Pane = {
      id: "p1",
      kind: "terminal",
      payload: { title: "Term 1" },
    };
    useWorkspaceStore.setState({
      tabs: [baseTab("t1", [pane])],
      activeTabId: "t1",
    } as Parameters<typeof useWorkspaceStore.setState>[0]);
    const obs = buildObservation("heartbeat");
    expect(obs.panes).toHaveLength(1);
    expect(obs.panes[0].screenTail).toContain("[pane p1]");
    expect(obs.panes[0].lastCommand).toBe("echo hi");
    expect(obs.panes[0].lastExitCode).toBe(0);
  });

  it("derives taskId from spawnEnv.ANYSPACE_TASK_ID", () => {
    const pane: Pane = {
      id: "p1",
      kind: "terminal",
      payload: { spawnEnv: { ANYSPACE_TASK_ID: "task-42" } },
    };
    useWorkspaceStore.setState({
      tabs: [baseTab("t1", [pane])],
      activeTabId: "t1",
    } as Parameters<typeof useWorkspaceStore.setState>[0]);
    const obs = buildObservation("heartbeat");
    expect(obs.panes[0].taskId).toBe("task-42");
  });

  it("computes deltas across consecutive ticks", () => {
    const pane: Pane = { id: "p1", kind: "terminal" };
    useWorkspaceStore.setState({
      tabs: [baseTab("t1", [pane])],
      activeTabId: "t1",
    } as Parameters<typeof useWorkspaceStore.setState>[0]);
    useKanbanStore.setState({
      tasks: [
        { id: "a", title: "X", body: "", column: "todo", ordinal: 1, createdAt: 0, updatedAt: 0 },
      ],
      agents: [],
    } as Parameters<typeof useKanbanStore.setState>[0]);

    // First tick — primes memory, deltas will be empty (no prior state).
    const first = buildObservation("heartbeat");
    expect(first.deltas).toEqual([]);

    // Now mutate state: move the task and close the tab.
    useKanbanStore.setState({
      tasks: [
        { id: "a", title: "X", body: "", column: "in_progress", ordinal: 1, createdAt: 0, updatedAt: 0 },
      ],
      agents: [],
    } as Parameters<typeof useKanbanStore.setState>[0]);
    useWorkspaceStore.setState({ tabs: [], activeTabId: null } as Parameters<
      typeof useWorkspaceStore.setState
    >[0]);

    const second = buildObservation("kanban");
    expect(second.deltas).toContain("task \"X\" moved todo → in_progress");
    expect(second.deltas).toContain("tab t1 closed");
    expect(second.deltas).toContain("pane p1 closed");
  });

  it("keeps payload under 12 KB even with many panes", () => {
    // Build 60 terminal panes — the screen-tail mock returns ~50 chars/pane,
    // so without the cap this would balloon over 12 KB once tabs + deltas
    // are added.
    const panes: Pane[] = Array.from({ length: 60 }, (_, i) => ({
      id: `pane-${i}`,
      kind: "terminal",
    }));
    useWorkspaceStore.setState({
      tabs: [baseTab("t1", panes)],
      activeTabId: "t1",
    } as Parameters<typeof useWorkspaceStore.setState>[0]);

    const obs = buildObservation("heartbeat");
    const serialized = JSON.stringify(obs);
    expect(serialized.length).toBeLessThanOrEqual(12 * 1024);
  });
});
