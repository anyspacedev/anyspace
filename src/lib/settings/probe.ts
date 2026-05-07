import { aiChat } from "../tauri";

export type ProbeResult =
  | { ok: true; latencyMs: number; message: string }
  | { ok: false; message: string };

/**
 * Round-trip the AI endpoint with a 1-token request to validate
 * endpoint + key + model in one shot. Doesn't probe the actual chat
 * quality — just that the credentials and routing work.
 */
export async function probeAiEndpoint(args: {
  endpoint: string;
  apiKey: string;
  model: string;
}): Promise<ProbeResult> {
  if (!args.endpoint) return { ok: false, message: "Endpoint is empty." };
  if (!args.apiKey) return { ok: false, message: "API key is empty." };
  if (!args.model) return { ok: false, message: "Model is empty." };

  const t0 = performance.now();
  try {
    const reply = await aiChat({
      endpoint: args.endpoint,
      apiKey: args.apiKey,
      model: args.model,
      systemPrompt: "Reply with exactly the single character: ok",
      userMessage: "ping",
    });
    const ms = Math.round(performance.now() - t0);
    const preview = reply.trim().slice(0, 40);
    return {
      ok: true,
      latencyMs: ms,
      message: `OK · ${ms}ms${preview ? ` · "${preview}"` : ""}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
    return { ok: false, message: msg };
  }
}
