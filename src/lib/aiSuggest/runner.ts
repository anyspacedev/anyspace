import { piAiChat } from "./piAiChat";
import { useAiStore } from "../../stores/aiStore";
import { resolveAiCreds } from "../cloudCredentials";
import { openLoginGuide } from "../../stores/loginGuideStore";

export class AiSuggestNotConfiguredError extends Error {
  code = "not-configured" as const;
  constructor() {
    super(
      "AI is not configured — set endpoint / API key / model in Settings → AI before using AI suggestions.",
    );
    this.name = "AiSuggestNotConfiguredError";
  }
}

export class AiSuggestAuthRequiredError extends Error {
  code = "needs-signin" as const;
  constructor() {
    super("Sign in to AnySpace Cloud to use AI suggestions.");
    this.name = "AiSuggestAuthRequiredError";
  }
}

export type AiSuggestArgs<T> = {
  /** Surface tag, e.g. "team-decompose". Used in console logs. */
  surface: string;
  /** System prompt — must instruct the model to reply with strict JSON. */
  systemPrompt: string;
  /** Anything JSON-serialisable; sent as the user message verbatim. */
  context: unknown;
  /** Parser receives the extracted JSON object and must return the typed result. */
  parse: (obj: unknown) => T;
};

/**
 * Shared spine for every "Suggest with AI" surface.
 *
 * Validates the AI store, posts to aiChat, tolerantly extracts a JSON object
 * from the reply, and hands it to the caller's parser. All silent failure
 * modes go through console.* with a [suggestWithAi] prefix so devtools can
 * trace any click that "did nothing".
 */
export async function runAiSuggest<T>({
  surface,
  systemPrompt,
  context,
  parse,
}: AiSuggestArgs<T>): Promise<T> {
  const ai = useAiStore.getState().settings;
  console.log(`[suggestWithAi:${surface}] check`, {
    presetId: ai.presetId,
    hasEndpoint: !!ai.endpoint,
    hasKey: !!ai.apiKey,
    hasModel: !!ai.model,
    model: ai.model,
  });
  const creds = await resolveAiCreds(ai.presetId, {
    endpoint: ai.endpoint,
    apiKey: ai.apiKey,
    model: ai.model,
  });
  if (!creds.ok) {
    if (creds.reason === "needs-signin" || creds.reason === "no-token") {
      openLoginGuide("ai-explain");
      throw new AiSuggestAuthRequiredError();
    }
    throw new AiSuggestNotConfiguredError();
  }

  const userMessage = JSON.stringify(context, null, 2);
  console.log(`[suggestWithAi:${surface}] piAiChat`, { msglen: userMessage.length });

  const reply = await piAiChat({
    endpoint: creds.endpoint,
    apiKey: creds.apiKey,
    model: creds.model,
    systemPrompt,
    userMessage,
  });
  console.log(`[suggestWithAi:${surface}] reply`, reply.slice(0, 200));

  const json = extractJsonObject(reply);
  return parse(json);
}

/**
 * Strip optional ```json fences and trim to the outermost { … }. Tolerates
 * one or two stray sentences from less-disciplined models.
 */
export function extractJsonObject(reply: string): unknown {
  let s = reply.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`AI response was not JSON: ${reply.slice(0, 120)}`);
  }
  const slice = s.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch (err) {
    throw new Error(
      `AI response was not valid JSON: ${err instanceof Error ? err.message : err}`,
    );
  }
}

/**
 * Same as extractJsonObject but for arrays — useful when a surface wants a
 * top-level list. Not currently used by any surface; reserved for future
 * helpers (e.g. suggestKanbanTasks bulk).
 */
export function extractJsonArray(reply: string): unknown[] {
  let s = reply.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = s.indexOf("[");
  const end = s.lastIndexOf("]");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`AI response was not a JSON array: ${reply.slice(0, 120)}`);
  }
  try {
    const v = JSON.parse(s.slice(start, end + 1));
    if (!Array.isArray(v)) throw new Error("not an array");
    return v;
  } catch (err) {
    throw new Error(
      `AI response was not a valid JSON array: ${err instanceof Error ? err.message : err}`,
    );
  }
}
