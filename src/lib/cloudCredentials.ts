/**
 * Shared resolver for AI / Super Agent network credentials.
 *
 * Centralizes the "is this preset Teamship Cloud? then mint a Clerk JWT and
 * resolve VITE_TEAMSHIP_CLOUD_URL at call time, otherwise validate the BYO
 * config and pass it through" branch that would otherwise live inline at
 * every chat-completion call site.
 */

import { TEAMSHIP_CLOUD_URL, getAuthToken, isSignedIn } from "./auth";

import type { AiSettings } from "../stores/aiStore";
import { TEAMSHIP_CLOUD_DEFAULT_MODEL } from "../stores/aiStore";

export type CredFallback = {
  endpoint: string;
  apiKey: string;
  model: string;
};

export type ResolvedCreds =
  | { ok: true; endpoint: string; apiKey: string; model: string }
  | {
      ok: false;
      reason: "needs-signin" | "no-cloud-url" | "no-token" | "missing-config";
    };

/**
 * Resolve runtime credentials for a chat-completion request.
 *
 * - `presetId === "teamship-cloud"`: requires sign-in, mints a fresh Clerk
 *   JWT (skipCache), and resolves the endpoint from `TEAMSHIP_CLOUD_URL`.
 * - Anything else: returns `fallback` if all three fields are non-empty,
 *   otherwise reports `missing-config` so the caller can surface a hint.
 */
export async function resolveAiCreds(
  presetId: AiSettings["presetId"],
  fallback: CredFallback,
): Promise<ResolvedCreds> {
  if (presetId === "teamship-cloud") {
    if (!TEAMSHIP_CLOUD_URL) {
      return { ok: false, reason: "no-cloud-url" };
    }
    if (!isSignedIn()) {
      return { ok: false, reason: "needs-signin" };
    }
    const token = await getAuthToken();
    if (!token) {
      return { ok: false, reason: "no-token" };
    }
    return {
      ok: true,
      endpoint: TEAMSHIP_CLOUD_URL,
      apiKey: token,
      model: fallback.model || TEAMSHIP_CLOUD_DEFAULT_MODEL,
    };
  }

  if (!fallback.endpoint || !fallback.apiKey || !fallback.model) {
    return { ok: false, reason: "missing-config" };
  }
  return {
    ok: true,
    endpoint: fallback.endpoint,
    apiKey: fallback.apiKey,
    model: fallback.model,
  };
}
