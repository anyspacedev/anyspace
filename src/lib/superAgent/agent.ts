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
  /** Pi callback fired before every tool invocation. Return `{block: true}`
   *  to short-circuit with a synthetic error result. Panel bridge uses this
   *  for the pause/queue gate. */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;
};

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

  const systemPrompt = opts.systemPromptOverride ?? sa.systemPrompt ?? "";

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

  const tools = filterEnabledTools(sa.toolEnabled);
  const memoryWindow = sa.memoryWindow > 0 ? sa.memoryWindow : 30;

  return new Agent({
    initialState: { systemPrompt, model, tools, messages: opts.messages },
    getApiKey,
    toolExecution: "sequential",
    transformContext: async (msgs) => trimMemoryWindow(msgs, memoryWindow),
    beforeToolCall: opts.beforeToolCall,
  });
}
