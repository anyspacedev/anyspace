/**
 * Pi `Agent` factory for Super Agent. Phase 4a of the pi-agent-framework
 * refactor.
 *
 * Production callers pass `{sessionId, messages}` and the factory resolves
 * the runtime model + Bearer token via the same `resolveAiCreds` path the
 * legacy runner uses. Tests pass `{modelOverride, getApiKeyOverride}` to
 * inject the faux provider (or any non-AnySpace-Cloud key).
 *
 * Persistence is not wired here — that lives in `piRunner.ts` so this
 * factory stays a pure builder.
 */

import { Agent } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type {
  AgentMessage,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";

import { resolveAiCreds } from "../cloudCredentials";
import { useAiStore } from "../../stores/aiStore";
import { useSuperAgentSettingsStore } from "../../stores/superAgentSettingsStore";
import { filterEnabledTools } from "./tools/index";
import { getPrompt } from "../promptOverrides";

export type CreateSuperAgentOptions = {
  sessionId: string;
  /** Pre-loaded history. Caller is responsible for calling
   *  `loadAgentMessages(sessionId)` so persistence-side migrations run before
   *  the agent observes the conversation. */
  messages: AgentMessage[];
  /** Test hook: bypass `resolveAiCreds` + the OpenAI-completions Model
   *  construction. When supplied, `getApiKeyOverride` MUST also be supplied. */
  modelOverride?: Model<string>;
  /** Test hook: bypass `resolveAiCreds` for the Bearer token. */
  getApiKeyOverride?: () => string | undefined | Promise<string | undefined>;
  /** Optional per-session override; falls back to settings systemPrompt. */
  systemPromptOverride?: string;
  /** "background" restricts the tool surface to read-only + propose_action
   *  and appends a system-prompt suffix steering the model into observe-and-
   *  propose mode. Default "user". */
  mode?: "user" | "background";
  /** Pi callback fired before every tool invocation. Return `{block: true}`
   *  to short-circuit with a synthetic error result. Panel bridge uses this
   *  for the pause/queue gate. */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
};

export const SUPER_AGENT_BACKGROUND_SUFFIX_DEFAULT =
  "\n\nYou are running in observe-and-propose mode. You CANNOT call write tools — only read-only tools and `propose_action` are available to you. To suggest any change the user should consider, call `propose_action` with the appropriate kind and args. Pick `confidence` honestly: low when uncertain, high only when the evidence is unambiguous. Bias toward in-progress / wait when a task or pane is mid-stream — never propose `complete` for a kanban task unless the terminal output explicitly indicates completion. Stay silent (no tool calls, no text) when nothing in the observation needs attention.";

/** Trailing-window history slice that backs up if the cut would orphan a
 *  `toolResult` from its preceding assistant tool_call. Mirrors the legacy
 *  `buildHistory` repair in `runner.ts`. */
function trimMemoryWindow(messages: AgentMessage[], window: number): AgentMessage[] {
  if (window <= 0 || messages.length <= window) return messages;
  let start = messages.length - window;
  while (start > 0 && messages[start]?.role === "toolResult") {
    start--;
  }
  return messages.slice(start);
}

export async function createSuperAgent(opts: CreateSuperAgentOptions): Promise<Agent> {
  const sa = useSuperAgentSettingsStore.getState().settings;
  const ai = useAiStore.getState().settings;

  const mode = opts.mode ?? "user";
  const basePrompt = opts.systemPromptOverride ?? sa.systemPrompt ?? "";
  const systemPrompt =
    mode === "background"
      ? basePrompt + getPrompt("superAgentBackgroundSuffix", SUPER_AGENT_BACKGROUND_SUFFIX_DEFAULT)
      : basePrompt;

  let model: Model<string>;
  let getApiKey: () => string | undefined | Promise<string | undefined>;

  if (opts.modelOverride && opts.getApiKeyOverride) {
    model = opts.modelOverride;
    getApiKey = opts.getApiKeyOverride;
  } else {
    const presetId = sa.presetId === "inherit" ? ai.presetId : sa.presetId;
    const fallback = {
      endpoint: sa.endpoint || ai.endpoint,
      apiKey: sa.apiKey || ai.apiKey,
      model: sa.model || ai.model,
    };
    const resolved = await resolveAiCreds(presetId, fallback);
    if (!resolved.ok) {
      throw new Error(`Super Agent credentials not ready: ${resolved.reason}`);
    }
    model = {
      id: resolved.model,
      name: resolved.model,
      api: "openai-completions",
      provider: "openai",
      baseUrl: resolved.endpoint,
      reasoning: false,
      input: sa.enableVision ? ["text", "image"] : ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 128_000,
      maxTokens: 4_096,
    };
    getApiKey = () => resolved.apiKey;
  }

  const tools = filterEnabledTools(sa.toolEnabled, mode);
  const memoryWindow = sa.memoryWindow > 0 ? sa.memoryWindow : 30;

  return new Agent({
    initialState: { systemPrompt, model, tools, messages: opts.messages },
    getApiKey,
    toolExecution: "sequential",
    transformContext: async (msgs) => trimMemoryWindow(msgs, memoryWindow),
    beforeToolCall: opts.beforeToolCall,
  });
}
