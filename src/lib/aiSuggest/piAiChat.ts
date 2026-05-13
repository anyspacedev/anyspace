/**
 * One-shot pi-ai chat completion, drop-in compatible with the legacy
 * `aiChat` Rust wrapper from `lib/tauri.ts`. Phase 5 of the
 * pi-agent-framework refactor.
 *
 * Used by Quick Suggest (⌘⇧B / Super Brain v1) and AI Explain — surfaces
 * that need a single non-streaming reply, no tools, no multi-turn. They
 * bypass `pi-agent-core`'s Agent class entirely and call pi-ai's
 * `completeSimple` directly.
 *
 * Same `{endpoint, apiKey, model, systemPrompt, userMessage} → Promise<string>`
 * signature as `aiChat` so call sites can swap by import.
 */

import { completeSimple, type Model, type TextContent } from "@earendil-works/pi-ai";

import type { AiChatArgs } from "../tauri";

function buildModel(endpoint: string, modelId: string): Model<"openai-completions"> {
  return {
    id: modelId,
    name: modelId,
    api: "openai-completions",
    provider: "openai",
    baseUrl: endpoint,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4_096,
  };
}

export type PiAiChatOptions = {
  /** Test hook: bypass the openai-completions Model construction. Mostly
   *  used for faux-provider verifies. */
  modelOverride?: Model<string>;
};

export async function piAiChat(args: AiChatArgs, opts: PiAiChatOptions = {}): Promise<string> {
  const model = opts.modelOverride ?? buildModel(args.endpoint, args.model);
  const reply = await completeSimple(
    model,
    {
      systemPrompt: args.systemPrompt,
      messages: [
        { role: "user", content: args.userMessage, timestamp: Date.now() },
      ],
    },
    { apiKey: args.apiKey },
  );
  if (reply.stopReason === "error" || reply.stopReason === "aborted") {
    throw new Error(reply.errorMessage || `pi-ai ${reply.stopReason}`);
  }
  return reply.content
    .filter((b): b is TextContent => b.type === "text")
    .map((b) => b.text)
    .join("");
}
