/**
 * Pi-backed entry point for running a user prompt through Super Agent.
 * Phase 4a of the pi-agent-framework refactor.
 *
 * Responsibilities:
 *  - Load history from persistence (triggers lazy legacy → v2 migration).
 *  - Build the `Agent` via `createSuperAgent`.
 *  - Subscribe to lifecycle events; persist new messages at `turn_end` and
 *    `agent_end` boundaries.
 *  - Forward events to the caller for UI rendering.
 *
 * No UI store coupling lives here — phase 4b wires that on top of the
 * `onEvent` callback.
 */

import type { Agent } from "@earendil-works/pi-agent-core";
import type {
  AgentEvent,
  AgentMessage,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";

import { createSuperAgent } from "./agent";
import { appendAgentMessage, loadAgentMessages } from "./persistence";

export type RunPiPromptOptions = {
  sessionId: string;
  text: string;
  /** Per-event hook. Return a promise to gate run settlement on async work
   *  (e.g. legacy-store updates in the panel bridge). Pi's `subscribe`
   *  contract awaits listener promises in order, so this serializes
   *  correctly with respect to subsequent events. */
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  modelOverride?: Model<string>;
  getApiKeyOverride?: () => string | undefined | Promise<string | undefined>;
  systemPromptOverride?: string;
  /** Forwarded to `createSuperAgent`. "background" restricts tools to
   *  read-only + propose_action. */
  mode?: "user" | "background";
  /** When false, skip the internal `super_agent_messages_v2` persistence.
   *  Set this from the panel bridge, which writes to the legacy v1 table
   *  via the existing Zustand store so the UI keeps rendering through the
   *  same code path. Defaults true for headless callers. */
  persist?: boolean;
  /** Optional agent ref hook — called once with the constructed Agent so the
   *  caller can store it for `.abort()`. */
  onAgentReady?: (agent: Agent) => void;
  /** Pi callback fired before every tool invocation. Threaded into
   *  `createSuperAgent`. */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
};

export type RunPiPromptResult = {
  agent: Agent;
  messages: AgentMessage[];
};

export async function runPiPrompt(
  opts: RunPiPromptOptions,
): Promise<RunPiPromptResult> {
  const initial = await loadAgentMessages(opts.sessionId);
  const agent = await createSuperAgent({
    sessionId: opts.sessionId,
    messages: initial,
    modelOverride: opts.modelOverride,
    getApiKeyOverride: opts.getApiKeyOverride,
    systemPromptOverride: opts.systemPromptOverride,
    mode: opts.mode,
    beforeToolCall: opts.beforeToolCall,
  });
  opts.onAgentReady?.(agent);

  const shouldPersist = opts.persist !== false;
  // Pi appends to `state.messages` as the run progresses. `turn_end` fires
  // after each assistant message + its tool results settle; `agent_end`
  // is the final boundary. Walking the tail via a cumulative cursor
  // persists each message exactly once.
  let persistedCount = initial.length;
  const persistTail = async () => {
    if (!shouldPersist) return;
    const all = agent.state.messages;
    while (persistedCount < all.length) {
      try {
        await appendAgentMessage(opts.sessionId, all[persistedCount]);
      } catch (err) {
        // best-effort — log and continue so the UI keeps moving.
        // eslint-disable-next-line no-console
        console.warn("[piRunner] persist failed", err);
      }
      persistedCount++;
    }
  };

  const unsubscribe = agent.subscribe(async (event) => {
    if (opts.onEvent) {
      await opts.onEvent(event);
    }
    if (event.type === "turn_end" || event.type === "agent_end") {
      await persistTail();
    }
  });

  try {
    await agent.prompt(opts.text);
  } finally {
    unsubscribe();
  }

  return { agent, messages: agent.state.messages };
}
