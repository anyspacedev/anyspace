import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  useBackgroundProposalsStore,
  describeProposal,
  isReversible,
  isWriteSensitive,
} from "../src/stores/backgroundProposalsStore";
import { useKanbanStore } from "../src/stores/kanbanStore";
import { useToastStore } from "../src/stores/toastStore";

const reset = () => {
  useBackgroundProposalsStore.setState({ proposals: [], dismissedUntil: {} });
  useToastStore.setState({ toasts: [] });
};

describe("backgroundProposalsStore.add", () => {
  beforeEach(reset);

  it("appends a pending proposal", () => {
    const r = useBackgroundProposalsStore.getState().add({
      kind: "note",
      args: { text: "hi" },
      reason: "smoke",
    });
    expect(r.added).toBe(true);
    expect(r.id).toBeTruthy();
    const proposals = useBackgroundProposalsStore.getState().proposals;
    expect(proposals).toHaveLength(1);
    expect(proposals[0].status).toBe("pending");
  });

  it("dedups same kind+args within 5 min", () => {
    const args = { taskId: "t1", column: "complete", prevColumn: "in_progress" };
    useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args,
      reason: "first",
    });
    const second = useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args: { ...args }, // different object reference, same content
      reason: "second",
    });
    expect(second.added).toBe(false);
    expect(useBackgroundProposalsStore.getState().proposals).toHaveLength(1);
  });

  it("treats different kind+args as distinct", () => {
    useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args: { taskId: "t1", column: "complete" },
      reason: "first",
    });
    useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args: { taskId: "t2", column: "complete" },
      reason: "different task",
    });
    expect(useBackgroundProposalsStore.getState().proposals).toHaveLength(2);
  });
});

describe("backgroundProposalsStore.dismiss", () => {
  beforeEach(reset);

  it("removes from list and seeds the 1h ledger", () => {
    const r = useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args: { taskId: "t1", column: "complete" },
      reason: "test",
    });
    expect(r.added).toBe(true);
    useBackgroundProposalsStore.getState().dismiss(r.id!);
    const s = useBackgroundProposalsStore.getState();
    expect(s.proposals).toHaveLength(0);
    const keys = Object.keys(s.dismissedUntil);
    expect(keys).toHaveLength(1);
    expect(s.dismissedUntil[keys[0]]).toBeGreaterThan(Date.now());
  });

  it("blocks re-add of the same tuple inside the dismissed window", () => {
    const args = { taskId: "t1", column: "complete" };
    const r1 = useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args,
      reason: "first",
    });
    useBackgroundProposalsStore.getState().dismiss(r1.id!);
    const r2 = useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args,
      reason: "re-proposed",
    });
    expect(r2.added).toBe(false);
    expect(useBackgroundProposalsStore.getState().proposals).toHaveLength(0);
  });
});

describe("backgroundProposalsStore.apply — routing", () => {
  beforeEach(reset);

  it("routes kanban.move to useKanbanStore.moveTask", async () => {
    const moveTask = vi.fn(async () => undefined);
    useKanbanStore.setState({ tasks: [], agents: [], moveTask } as Parameters<
      typeof useKanbanStore.setState
    >[0]);
    const r = useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args: { taskId: "t1", column: "complete", prevColumn: "in_progress" },
      reason: "done",
    });
    await useBackgroundProposalsStore.getState().apply(r.id!);
    expect(moveTask).toHaveBeenCalledWith("t1", "complete", expect.any(Number));
    const proposal = useBackgroundProposalsStore
      .getState()
      .proposals.find((p) => p.id === r.id);
    expect(proposal?.status).toBe("applied");
  });

  it("surfaces an Undo toast after applying kanban.move with prevColumn", async () => {
    const moveTask = vi.fn(async () => undefined);
    useKanbanStore.setState({ tasks: [], agents: [], moveTask } as Parameters<
      typeof useKanbanStore.setState
    >[0]);
    const r = useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args: { taskId: "t1", column: "complete", prevColumn: "in_progress" },
      reason: "done",
    });
    await useBackgroundProposalsStore.getState().apply(r.id!);
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].action?.label).toBe("Undo");

    moveTask.mockClear();
    toasts[0].action!.onClick();
    expect(moveTask).toHaveBeenCalledWith("t1", "in_progress", expect.any(Number));
  });

  it("leaves status pending and records applyError on failure", async () => {
    const moveTask = vi.fn(async () => {
      throw new Error("db locked");
    });
    useKanbanStore.setState({ tasks: [], agents: [], moveTask } as Parameters<
      typeof useKanbanStore.setState
    >[0]);
    const r = useBackgroundProposalsStore.getState().add({
      kind: "kanban.move",
      args: { taskId: "t1", column: "complete" },
      reason: "done",
    });
    await useBackgroundProposalsStore.getState().apply(r.id!);
    const p = useBackgroundProposalsStore
      .getState()
      .proposals.find((x) => x.id === r.id);
    expect(p?.status).toBe("pending");
    expect(p?.applyError).toBe("db locked");
  });

  it("note proposals are no-ops at apply time", async () => {
    const r = useBackgroundProposalsStore.getState().add({
      kind: "note",
      args: { text: "fyi" },
      reason: "informational",
    });
    await useBackgroundProposalsStore.getState().apply(r.id!);
    const p = useBackgroundProposalsStore
      .getState()
      .proposals.find((x) => x.id === r.id);
    expect(p?.status).toBe("applied");
  });
});

describe("describeProposal", () => {
  it("renders human-readable kanban.move label", () => {
    useKanbanStore.setState({
      tasks: [
        {
          id: "t1",
          title: "Refactor auth flow",
          body: "",
          column: "in_progress",
          ordinal: 1,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      agents: [],
    } as Parameters<typeof useKanbanStore.setState>[0]);
    const label = describeProposal({
      id: "x",
      ts: 0,
      kind: "kanban.move",
      args: { taskId: "t1", column: "in_review" },
      reason: "",
      status: "pending",
    });
    expect(label).toBe(`Move "Refactor auth flow" to In review`);
  });

  it("truncates long pty.write text", () => {
    const long = "echo " + "x".repeat(100);
    const label = describeProposal({
      id: "x",
      ts: 0,
      kind: "pty.write",
      args: { paneId: "abcdef123456", text: long },
      reason: "",
      status: "pending",
    });
    expect(label.length).toBeLessThan(80);
    expect(label).toContain("…");
  });
});

describe("kind classifiers", () => {
  it("isReversible matches kanban.move + kanban.update only", () => {
    expect(isReversible("kanban.move")).toBe(true);
    expect(isReversible("kanban.update")).toBe(true);
    expect(isReversible("pty.write")).toBe(false);
    expect(isReversible("pane.close")).toBe(false);
    expect(isReversible("team.broadcast")).toBe(false);
    expect(isReversible("note")).toBe(false);
  });

  it("isWriteSensitive flags pty/pane/team writes", () => {
    expect(isWriteSensitive("pty.write")).toBe(true);
    expect(isWriteSensitive("pane.close")).toBe(true);
    expect(isWriteSensitive("team.broadcast")).toBe(true);
    expect(isWriteSensitive("team.send_to_pane")).toBe(true);
    expect(isWriteSensitive("kanban.move")).toBe(false);
    expect(isWriteSensitive("note")).toBe(false);
  });
});
