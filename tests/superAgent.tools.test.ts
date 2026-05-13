import { describe, expect, it } from "vitest";

import { TOOLS } from "../src/lib/superAgent/tools";
import {
  filterEnabledTools,
  piTools,
} from "../src/lib/superAgent/tools/index";

describe("Super Agent tool registry", () => {
  it("registers propose_action as a read-only tool", () => {
    const tool = TOOLS.find((t) => t.name === "propose_action");
    expect(tool).toBeDefined();
    expect(tool?.readOnly).toBe(true);
  });

  it("exposes every legacy tool in the pi registry", () => {
    expect(piTools.length).toBe(TOOLS.length);
    for (const t of TOOLS) {
      expect(piTools.some((p) => p.name === t.name)).toBe(true);
    }
  });
});

describe("filterEnabledTools(mode='background')", () => {
  it("drops every readOnly:false tool", () => {
    const filtered = filterEnabledTools({}, "background");
    const writeNames = TOOLS.filter((t) => !t.readOnly).map((t) => t.name);
    for (const name of writeNames) {
      expect(filtered.some((p) => p.name === name)).toBe(false);
    }
  });

  it("keeps propose_action and every readOnly:true tool", () => {
    const filtered = filterEnabledTools({}, "background");
    const readNames = TOOLS.filter((t) => t.readOnly).map((t) => t.name);
    for (const name of readNames) {
      expect(filtered.some((p) => p.name === name)).toBe(true);
    }
    expect(filtered.some((p) => p.name === "propose_action")).toBe(true);
  });

  it("default 'user' mode keeps write tools", () => {
    const filtered = filterEnabledTools({});
    const writeNames = TOOLS.filter((t) => !t.readOnly).map((t) => t.name);
    for (const name of writeNames) {
      expect(filtered.some((p) => p.name === name)).toBe(true);
    }
  });

  it("respects the toolEnabled map even in background mode", () => {
    const filtered = filterEnabledTools({ propose_action: false }, "background");
    expect(filtered.some((p) => p.name === "propose_action")).toBe(false);
  });
});

describe("propose_action handler", () => {
  it("queues a proposal into the store and returns its id", async () => {
    const tool = TOOLS.find((t) => t.name === "propose_action")!;
    // Reset store between cases by importing fresh.
    const { useBackgroundProposalsStore } = await import(
      "../src/stores/backgroundProposalsStore"
    );
    useBackgroundProposalsStore.setState({ proposals: [], dismissedUntil: {} });

    const result = await tool.handler({
      kind: "note",
      args: { text: "hi there" },
      reason: "smoke test",
      confidence: "medium",
    });
    const parsed = JSON.parse(result.resultText);
    expect(parsed.status).toBe("queued");
    expect(parsed.proposalId).toBeTruthy();
    expect(useBackgroundProposalsStore.getState().proposals).toHaveLength(1);
  });

  it("reports 'deduped' for the same kind+args within 5 min", async () => {
    const tool = TOOLS.find((t) => t.name === "propose_action")!;
    const { useBackgroundProposalsStore } = await import(
      "../src/stores/backgroundProposalsStore"
    );
    useBackgroundProposalsStore.setState({ proposals: [], dismissedUntil: {} });

    await tool.handler({
      kind: "kanban.move",
      args: { taskId: "t1", column: "in_review", prevColumn: "in_progress" },
      reason: "agent errored",
    });
    const second = await tool.handler({
      kind: "kanban.move",
      args: { taskId: "t1", column: "in_review", prevColumn: "in_progress" },
      reason: "agent errored (again)",
    });
    const parsed = JSON.parse(second.resultText);
    expect(parsed.status).toBe("deduped");
    expect(useBackgroundProposalsStore.getState().proposals).toHaveLength(1);
  });

  it("rejects calls missing kind", async () => {
    const tool = TOOLS.find((t) => t.name === "propose_action")!;
    const result = await tool.handler({ args: {}, reason: "x" });
    const parsed = JSON.parse(result.resultText);
    expect(parsed.error).toContain("missing kind");
  });
});
