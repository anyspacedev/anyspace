/**
 * Pi → legacy-store bridge for the Super Agent panel. Phase 4b of the
 * pi-agent-framework refactor.
 *
 * The panel's existing rendering reads from `useSuperAgentStore`'s
 * `messagesBySession` map. To swap in the pi runner without touching the
 * panel UI, we translate `AgentEvent`s into `appendMessage` /
 * `updateMessage` calls on that same store. The store keeps writing to
 * the legacy `super_agent_messages` table — the new v2 table catches up
 * lazily on next session load via `loadAgentMessages`'s backfill.
 *
 * Pause/queue tool-call gating is intentionally NOT wired here yet —
 * phase 4b minimum focuses on the streaming + tool-call display + abort
 * path. Phase 4b polish (or 4c) extends `beforeToolCall` to drive
 * `decideQueuedToolCall`.
 */

import type { Agent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";

import { maybeAutoNameSession } from "./autoName";
import { runPiPrompt, type RunPiPromptOptions } from "./piRunner";
import {
  useSuperAgentStore,
  type Message,
  type ToolCall,
  type ToolResult,
  type ToolResultImage,
} from "../../stores/superAgentStore";

type ActiveRun = {
  sessionId: string;
  agent: Agent;
  /** Live assistant message id for the in-flight turn, if any. */
  liveAssistantId?: string;
  /** Cumulative streamed text for the live assistant (text content only). */
  assistantText: string;
  /** Cumulative streamed thinking text for the live assistant. */
  thinkingText: string;
  /** Tool calls observed so far on the live assistant (for finalization). */
  liveToolCalls: ToolCall[];
  /** Map of running tool calls → legacy tool message id, so
   *  `tool_execution_end` can update the right row. */
  toolCallIdToMessageId: Map<string, string>;
};

let activeRun: ActiveRun | null = null;

function freshTurn(run: ActiveRun): void {
  run.liveAssistantId = undefined;
  run.assistantText = "";
  run.thinkingText = "";
  run.liveToolCalls = [];
}

/** Wait for the operator to flip a queued tool result's status. Mirrors the
 *  legacy `awaitQueuedDecision` in `runner.ts` so `decideQueuedToolCall`
 *  drives pi mode too. */
async function awaitQueuedDecision(
  sessionId: string,
  messageId: string,
  callId: string,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const unsub = useSuperAgentStore.subscribe((state) => {
      const list = state.messagesBySession[sessionId] ?? [];
      const msg = list.find((m) => m.id === messageId);
      const result = msg?.toolResults?.find((r) => r.callId === callId);
      if (result && result.status !== "queued") {
        unsub();
        resolve(result);
      }
    });
  });
}

function buildBeforeToolCall(
  run: ActiveRun,
): (ctx: BeforeToolCallContext) => Promise<BeforeToolCallResult | undefined> {
  return async (ctx) => {
    const store = useSuperAgentStore.getState();
    if (!store.pauseToolCalls) return undefined;

    // Pi already fired `tool_execution_start` before this callback (see
    // agent-loop.js:246-251 sequential, :279-283 parallel), so `handleEvent`
    // has already created the tool row with status "running". Flip it to
    // "queued" so the panel renders Run/Skip buttons, await the operator's
    // decision, and either let pi proceed or short-circuit.
    const messageId = run.toolCallIdToMessageId.get(ctx.toolCall.id);
    if (!messageId) {
      // Defensive fallback — tool_execution_start should always have run
      // first. If not, just let pi proceed without the queue gate.
      return undefined;
    }
    await store.updateMessage(run.sessionId, messageId, {
      toolResults: [
        { callId: ctx.toolCall.id, status: "queued", resultText: "" },
      ],
    });

    const decision = await awaitQueuedDecision(
      run.sessionId,
      messageId,
      ctx.toolCall.id,
    );
    if (decision.status === "skipped") {
      // Finalize the row as "skipped" right here and remove from the map
      // so the upcoming `tool_execution_end` (which pi still emits for
      // blocked calls) doesn't overwrite the status to "error".
      await store.updateMessage(run.sessionId, messageId, {
        toolResults: [
          {
            callId: ctx.toolCall.id,
            status: "skipped",
            resultText: JSON.stringify({ skipped: true, by: "operator" }),
          },
        ],
      });
      run.toolCallIdToMessageId.delete(ctx.toolCall.id);
      return { block: true, reason: "Skipped by operator" };
    }
    // Decision was "run". Pi will proceed to execute(); `tool_execution_end`
    // will fire normally and update the row to ok/error.
    await store.updateMessage(run.sessionId, messageId, {
      toolResults: [
        { callId: ctx.toolCall.id, status: "running", resultText: "" },
      ],
    });
    return undefined;
  };
}

function updateMessageContent(
  sessionId: string,
  messageId: string,
  patch: Partial<Message>,
): void {
  useSuperAgentStore.setState((s) => ({
    messagesBySession: {
      ...s.messagesBySession,
      [sessionId]: (s.messagesBySession[sessionId] ?? []).map((m) =>
        m.id === messageId ? { ...m, ...patch } : m,
      ),
    },
  }));
}

async function handleEvent(run: ActiveRun, event: AgentEvent): Promise<void> {
  const store = useSuperAgentStore.getState();
  const { sessionId } = run;

  if (event.type === "turn_start") {
    freshTurn(run);
    return;
  }

  if (event.type === "message_start") {
    // Pi emits message_start for assistant turns; create a streaming
    // assistant bubble in the legacy store so the panel renders it.
    if (event.message?.role !== "assistant") return;
    const msg = await store.appendMessage({
      sessionId,
      role: "assistant",
      content: "",
    });
    run.liveAssistantId = msg.id;
    updateMessageContent(sessionId, msg.id, { streaming: true });
    return;
  }

  if (event.type === "message_update") {
    if (!run.liveAssistantId) return;
    const e = event.assistantMessageEvent;
    if (e.type === "text_delta") {
      run.assistantText += e.delta;
      updateMessageContent(sessionId, run.liveAssistantId, {
        content: run.assistantText,
      });
    } else if (e.type === "thinking_delta") {
      run.thinkingText += e.delta;
      updateMessageContent(sessionId, run.liveAssistantId, {
        reasoningContent: run.thinkingText,
      });
    } else if (e.type === "toolcall_end") {
      // Pi finalized one tool call; capture it for the assistant message.
      run.liveToolCalls.push({
        id: e.toolCall.id,
        name: e.toolCall.name,
        arguments: (e.toolCall.arguments as Record<string, unknown>) ?? {},
      });
    }
    return;
  }

  if (event.type === "message_end") {
    if (!run.liveAssistantId) return;
    if (event.message?.role !== "assistant") return;
    // Finalize via store.updateMessage (writes the DB row).
    await store.updateMessage(sessionId, run.liveAssistantId, {
      content: run.assistantText,
      reasoningContent: run.thinkingText || undefined,
      toolCalls: run.liveToolCalls.length ? run.liveToolCalls : undefined,
      streaming: false,
    });
    void maybeAutoNameSession(sessionId);
    return;
  }

  if (event.type === "tool_execution_start") {
    // Pi emits this BEFORE beforeToolCall (agent-loop.js:246-251). Create
    // the tool row up front; beforeToolCall flips its status to "queued"
    // if pauseToolCalls is on, otherwise the row stays "running" while
    // execute() runs.
    const result: ToolResult = {
      callId: event.toolCallId,
      status: "running",
      resultText: "",
    };
    const msg = await store.appendMessage({
      sessionId,
      role: "tool",
      content: "",
      toolResults: [result],
    });
    run.toolCallIdToMessageId.set(event.toolCallId, msg.id);
    return;
  }

  if (event.type === "tool_execution_end") {
    const messageId = run.toolCallIdToMessageId.get(event.toolCallId);
    if (!messageId) return;
    const text = extractToolResultText(event.result);
    const images = extractImagePaths(event.result);
    const merged: ToolResult = {
      callId: event.toolCallId,
      status: event.isError ? "error" : "ok",
      resultText: text,
      errorMessage: event.isError ? text : undefined,
      ...(images.length ? { images } : {}),
    };
    await store.updateMessage(sessionId, messageId, {
      toolResults: [merged],
    });
    run.toolCallIdToMessageId.delete(event.toolCallId);
    return;
  }
}

function extractToolResultText(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as { content?: { type?: string; text?: string }[] };
  const text = r.content?.find((b) => b.type === "text")?.text;
  return text ?? "";
}

/** Pull the original on-disk image paths out of the adapter's `details`
 *  shape (`PiToolDetails.imagePaths`). The panel renders thumbnails from
 *  paths — not base64 — so this avoids inflating the persisted result. */
function extractImagePaths(result: unknown): ToolResultImage[] {
  if (!result || typeof result !== "object") return [];
  const r = result as { details?: { imagePaths?: { path: string; mediaType: string }[] } };
  const paths = r.details?.imagePaths;
  if (!Array.isArray(paths)) return [];
  return paths
    .filter(
      (p): p is { path: string; mediaType: string } =>
        !!p && typeof p.path === "string" && typeof p.mediaType === "string",
    )
    .map((p) => ({ path: p.path, mediaType: p.mediaType }));
}

export type SendUserMessageViaPiOptions = Omit<
  RunPiPromptOptions,
  "sessionId" | "text" | "onEvent" | "persist" | "onAgentReady"
>;

/** Pi-runner replacement for `sendUserMessage` in `runner.ts`. Mirrors its
 *  side effects on the legacy store (user-bubble append, streaming
 *  assistant, tool-call cards) while delegating the actual model + tool
 *  loop to pi-agent-core. */
export async function sendUserMessageViaPi(
  sessionId: string,
  text: string,
  opts: SendUserMessageViaPiOptions = {},
): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const store = useSuperAgentStore.getState();
  await store.appendMessage({ sessionId, role: "user", content: trimmed });

  const run: ActiveRun = {
    sessionId,
    agent: null as unknown as Agent, // populated by onAgentReady
    assistantText: "",
    thinkingText: "",
    liveToolCalls: [],
    toolCallIdToMessageId: new Map(),
  };

  try {
    await runPiPrompt({
      sessionId,
      text: trimmed,
      persist: false, // legacy store writes to v1; v2 fills on next backfill
      onAgentReady: (agent) => {
        run.agent = agent;
        activeRun = run;
      },
      onEvent: async (event) => {
        await handleEvent(run, event);
      },
      beforeToolCall: buildBeforeToolCall(run),
      ...opts,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.appendMessage({
      sessionId,
      role: "assistant",
      content: `Super Agent error: ${message}`,
    });
  } finally {
    if (activeRun === run) activeRun = null;
  }
}

/** Pi-runner replacement for `abortActive`. Calls `.abort()` on the in-flight
 *  agent; pi unwinds with stopReason "aborted". */
export function abortActivePi(): void {
  const run = activeRun;
  if (!run) return;
  try {
    run.agent.abort();
  } catch {
    /* best-effort */
  }
}

/** Test-only: read the currently-active run (used by faux verify). */
export function __activeRunForTesting(): ActiveRun | null {
  return activeRun;
}
