/**
 * Super Agent entry point. Phase 6 of the pi-agent-framework refactor:
 * the legacy Rust-SSE ReAct loop is gone — every prompt flows through
 * `panelBridge` (Pi `Agent`).
 *
 * This module exists as a thin shim so existing imports
 * (`SuperAgentPanel`, `ToolCallCard`) keep working. New code should
 * import from `panelBridge` directly.
 */

import { abortActivePi, sendUserMessageViaPi } from "./panelBridge";
import { useSuperAgentStore, type ToolResult } from "../../stores/superAgentStore";

export async function sendUserMessage(sessionId: string, text: string): Promise<void> {
  await sendUserMessageViaPi(sessionId, text);
}

export async function abortActive(): Promise<void> {
  abortActivePi();
}

/** Operator-driven decision for a queued tool call. `panelBridge`'s
 *  `buildBeforeToolCall` observes the status flip via store subscribe and
 *  unblocks pi accordingly. */
export async function decideQueuedToolCall(
  sessionId: string,
  messageId: string,
  callId: string,
  decision: "run" | "skip",
): Promise<void> {
  const list = useSuperAgentStore.getState().messagesBySession[sessionId] ?? [];
  const msg = list.find((m) => m.id === messageId);
  if (!msg) return;
  const merged = (msg.toolResults ?? []).map((r) =>
    r.callId === callId
      ? { ...r, status: (decision === "run" ? "running" : "skipped") as ToolResult["status"] }
      : r,
  );
  await useSuperAgentStore.getState().updateMessage(sessionId, messageId, {
    toolResults: merged,
  });
}
