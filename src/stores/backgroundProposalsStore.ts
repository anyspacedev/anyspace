/**
 * Background Super Agent proposals — in-memory only.
 *
 * The background watcher's SA session is restricted to read-only tools; the
 * one exception is `propose_action` which appends to this store. The user
 * reviews + clicks Apply to actually execute the write.
 *
 * Dedup: same `kind + canonicalJSON(args)` within 5 min is dropped. If the
 * user dismissed that tuple, the window extends to 1 hour so the AI doesn't
 * re-surface what was just rejected.
 */

import { create } from "zustand";
import { useKanbanStore } from "./kanbanStore";
import { useWorkspaceStore } from "./workspaceStore";
import { useTeamStore } from "./teamStore";
import { toast } from "./toastStore";
import { ptyWrite } from "../lib/tauri";
import { getTerminalSessionId } from "../components/terminal/terminalRegistry";
import { runSuperBrainTeamBroadcast } from "../lib/superBrain";
import type { Task } from "../lib/types";

export type ProposalKind =
  | "kanban.move"
  | "kanban.update"
  | "pty.write"
  | "team.broadcast"
  | "team.send_to_pane"
  | "pane.close"
  | "note";

export type ProposalConfidence = "low" | "medium" | "high";

export type Proposal = {
  id: string;
  ts: number;
  kind: ProposalKind;
  args: Record<string, unknown>;
  reason: string;
  confidence?: ProposalConfidence;
  status: "pending" | "applying" | "applied" | "dismissed";
  /** Inline error from a failed Apply — surfaced in the row, cleared on retry. */
  applyError?: string;
};

const DEDUP_WINDOW_MS = 5 * 60_000;
const DISMISSED_WINDOW_MS = 60 * 60_000;
const MAX_VISIBLE_PROPOSALS = 200;

const newId = () => Math.random().toString(36).slice(2, 12);

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJson((value as Record<string, unknown>)[k]))
      .join(",") +
    "}"
  );
}

function proposalKey(kind: ProposalKind, args: Record<string, unknown>): string {
  return kind + "::" + canonicalJson(args);
}

type ProposalsState = {
  proposals: Proposal[];
  /** Tuples the user dismissed; mapped to expiry timestamp for the 1h window. */
  dismissedUntil: Record<string, number>;
  add: (
    p: Omit<Proposal, "id" | "ts" | "status" | "applyError">,
  ) => { added: boolean; id?: string };
  apply: (id: string) => Promise<void>;
  dismiss: (id: string) => void;
  clearApplied: () => void;
};

export const useBackgroundProposalsStore = create<ProposalsState>((set, get) => ({
  proposals: [],
  dismissedUntil: {},

  add: (p) => {
    const now = Date.now();
    const key = proposalKey(p.kind, p.args);
    const existing = get().proposals;
    const dismissedUntil = get().dismissedUntil[key];
    if (dismissedUntil && dismissedUntil > now) {
      return { added: false };
    }
    const recent = existing.find((q) => {
      if (q.status !== "pending" && q.status !== "applying") return false;
      if (proposalKey(q.kind, q.args) !== key) return false;
      return now - q.ts < DEDUP_WINDOW_MS;
    });
    if (recent) return { added: false, id: recent.id };

    const id = newId();
    const proposal: Proposal = {
      id,
      ts: now,
      kind: p.kind,
      args: p.args,
      reason: p.reason,
      confidence: p.confidence,
      status: "pending",
    };
    const next = [proposal, ...existing].slice(0, MAX_VISIBLE_PROPOSALS);
    set({ proposals: next });
    return { added: true, id };
  },

  apply: async (id) => {
    const proposal = get().proposals.find((p) => p.id === id);
    if (!proposal) return;
    if (proposal.status === "applying" || proposal.status === "applied") return;

    set((s) => ({
      proposals: s.proposals.map((p) =>
        p.id === id ? { ...p, status: "applying", applyError: undefined } : p,
      ),
    }));

    try {
      await executeProposal(proposal);
      set((s) => ({
        proposals: s.proposals.map((p) =>
          p.id === id ? { ...p, status: "applied", applyError: undefined } : p,
        ),
      }));
      surfaceUndoToast(proposal);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      set((s) => ({
        proposals: s.proposals.map((p) =>
          p.id === id ? { ...p, status: "pending", applyError: message } : p,
        ),
      }));
    }
  },

  dismiss: (id) => {
    const proposal = get().proposals.find((p) => p.id === id);
    if (!proposal) return;
    const key = proposalKey(proposal.kind, proposal.args);
    set((s) => ({
      proposals: s.proposals.filter((p) => p.id !== id),
      dismissedUntil: {
        ...s.dismissedUntil,
        [key]: Date.now() + DISMISSED_WINDOW_MS,
      },
    }));
  },

  clearApplied: () => {
    set((s) => ({
      proposals: s.proposals.filter((p) => p.status !== "applied"),
    }));
  },
}));

async function executeProposal(p: Proposal): Promise<void> {
  switch (p.kind) {
    case "kanban.move": {
      const taskId = String(p.args.taskId ?? "");
      const column = p.args.column as Task["column"];
      if (!taskId || !column) throw new Error("missing taskId or column");
      await useKanbanStore.getState().moveTask(taskId, column, Date.now());
      return;
    }
    case "kanban.update": {
      const taskId = String(p.args.taskId ?? "");
      const patch = (p.args.patch ?? {}) as Partial<Task>;
      if (!taskId) throw new Error("missing taskId");
      await useKanbanStore.getState().updateTask(taskId, patch);
      return;
    }
    case "pty.write": {
      const paneId = String(p.args.paneId ?? "");
      const text = String(p.args.text ?? "");
      const withNewline = Boolean(p.args.withNewline);
      if (!paneId) throw new Error("missing paneId");
      const sid = getTerminalSessionId(paneId);
      if (!sid) throw new Error(`pane ${paneId} has no live PTY session`);
      const payload = withNewline ? text + "\n" : text;
      await ptyWrite(sid, new TextEncoder().encode(payload));
      return;
    }
    case "team.broadcast": {
      const teamId = String(p.args.teamId ?? "");
      const text = String(p.args.text ?? "");
      const withNewline = Boolean(p.args.withNewline);
      if (!teamId) throw new Error("missing teamId");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) throw new Error(`team ${teamId} not found`);
      if (!team.tabId) throw new Error(`team ${teamId} has no live tab`);
      const payload = withNewline ? text + "\n" : text;
      await runSuperBrainTeamBroadcast(team.tabId, payload);
      return;
    }
    case "team.send_to_pane": {
      const teamId = String(p.args.teamId ?? "");
      const text = String(p.args.text ?? "");
      const withNewline = Boolean(p.args.withNewline);
      const label = p.args.label ? String(p.args.label) : undefined;
      let paneId = p.args.paneId ? String(p.args.paneId) : undefined;
      if (!teamId) throw new Error("missing teamId");
      if (!paneId && label) {
        const roster = useTeamStore.getState().agents[teamId] ?? [];
        const match = roster.find((a) => a.label === label);
        if (!match) throw new Error(`label "${label}" not found in team roster`);
        if (!match.paneId) throw new Error(`agent "${label}" has no live pane`);
        paneId = match.paneId;
      }
      if (!paneId) throw new Error("provide paneId or label");
      const sid = getTerminalSessionId(paneId);
      if (!sid) throw new Error(`pane ${paneId} has no live PTY session`);
      const payload = withNewline ? text + "\n" : text;
      await ptyWrite(sid, new TextEncoder().encode(payload));
      return;
    }
    case "pane.close": {
      const tabId = String(p.args.tabId ?? "");
      const paneId = String(p.args.paneId ?? "");
      if (!tabId || !paneId) throw new Error("missing tabId or paneId");
      useWorkspaceStore.getState().closePane(tabId, paneId);
      return;
    }
    case "note":
      return; // notes have no Apply action; handled by UI.
  }
}

function surfaceUndoToast(p: Proposal): void {
  if (p.kind === "kanban.move") {
    const taskId = String(p.args.taskId ?? "");
    const targetColumn = p.args.column as Task["column"];
    const prevColumn = p.args.prevColumn as Task["column"] | undefined;
    if (!taskId || !prevColumn || prevColumn === targetColumn) return;
    toast.info("Moved task", `→ ${columnLabel(targetColumn)}`, {
      label: "Undo",
      onClick: () => {
        void useKanbanStore.getState().moveTask(taskId, prevColumn, Date.now());
      },
    });
    return;
  }
  if (p.kind === "kanban.update") {
    const taskId = String(p.args.taskId ?? "");
    const prevPatch = (p.args.prevPatch ?? null) as Partial<Task> | null;
    if (!taskId || !prevPatch) return;
    toast.info("Updated task", "Reverting will restore previous values.", {
      label: "Undo",
      onClick: () => {
        void useKanbanStore.getState().updateTask(taskId, prevPatch);
      },
    });
    return;
  }
}

function columnLabel(col: Task["column"]): string {
  switch (col) {
    case "todo":
      return "Todo";
    case "in_progress":
      return "In progress";
    case "in_review":
      return "In review";
    case "complete":
      return "Complete";
  }
}

/** Render a human label from kind+args for the UI. Kept here so the store
 *  fully owns the proposal shape. */
export function describeProposal(p: Proposal): string {
  switch (p.kind) {
    case "kanban.move": {
      const taskId = String(p.args.taskId ?? "");
      const column = p.args.column as Task["column"] | undefined;
      const task = useKanbanStore.getState().tasks.find((t) => t.id === taskId);
      const title = task?.title ?? taskId;
      return `Move "${title}" to ${column ? columnLabel(column) : "?"}`;
    }
    case "kanban.update": {
      const taskId = String(p.args.taskId ?? "");
      const task = useKanbanStore.getState().tasks.find((t) => t.id === taskId);
      const title = task?.title ?? taskId;
      return `Update "${title}"`;
    }
    case "pty.write": {
      const paneId = String(p.args.paneId ?? "");
      const text = String(p.args.text ?? "");
      const preview = text.length > 32 ? text.slice(0, 30) + "…" : text;
      return `Type ${JSON.stringify(preview)} into pane ${paneId.slice(0, 6)}`;
    }
    case "team.broadcast": {
      const teamId = String(p.args.teamId ?? "");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      const name = team?.name ?? teamId;
      const roster = useTeamStore.getState().agents[teamId] ?? [];
      return `Send to all ${roster.length || ""} agent${roster.length === 1 ? "" : "s"} on "${name}"`.trim();
    }
    case "team.send_to_pane": {
      const teamId = String(p.args.teamId ?? "");
      const label = p.args.label ? String(p.args.label) : undefined;
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      const name = team?.name ?? teamId;
      return label
        ? `Send to "${label}" on "${name}"`
        : `Send to a pane on "${name}"`;
    }
    case "pane.close":
      return `Close pane ${String(p.args.paneId ?? "").slice(0, 6)}`;
    case "note":
      return ""; // notes render reason only.
  }
}

/** True for proposals whose effect can be reversed via an Undo toast. */
export function isReversible(kind: ProposalKind): boolean {
  return kind === "kanban.move" || kind === "kanban.update";
}

/** True for proposals that touch state with broad side effects — UI uses
 *  this to relabel Apply → Send and to add extra button separation. */
export function isWriteSensitive(kind: ProposalKind): boolean {
  return (
    kind === "pty.write" ||
    kind === "pane.close" ||
    kind === "team.broadcast" ||
    kind === "team.send_to_pane"
  );
}
