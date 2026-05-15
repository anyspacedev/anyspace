/**
 * Frontend handler for the backend's 402 quota-exceeded responses.
 *
 * The backend's `services/usage_quota.py` raises `HTTPException(402, …)` with
 * a structured detail body when a Free user hits their monthly cap (or a Pro
 * user crosses the quiet fair-use ceiling). That JSON reaches us via three
 * different transports depending on the call site, so the parser does best-
 * effort extraction from all of them:
 *
 *   1. `fetch()` for /v1/usage and friends — `Response.status === 402` + JSON body.
 *   2. The openai SDK (pi-ai openai-completions provider) — `APIError.status === 402`.
 *   3. Tauri Rust IPC for STT — `Error("HTTP 402 from <url>: <json>")`.
 *
 * `tryHandleQuotaError(e)` returns `true` if it recognised + handled the error
 * (toasted with an Upgrade action, refreshed the subscription/usage meter).
 * Callers fall through to their normal error path when it returns `false`.
 */

import { open as openExternal } from "@tauri-apps/plugin-shell";

import { startCheckout } from "./billingApi";
import { useSubscriptionStore } from "../stores/subscriptionStore";
import { useToastStore } from "../stores/toastStore";

type QuotaKind = "ai" | "stt" | "pro_abuse";

export type QuotaErrorBody = {
  detail: string;
  plan: "free" | "pro";
  quota_kind: QuotaKind;
  used: number;
  limit: number;
  resets_at: string;
  upgrade_url?: string;
};

const TOAST_ID = "quota-error"; // de-dupes burst 402s from parallel tool calls

export function parseQuotaError(e: unknown): QuotaErrorBody | null {
  if (!e) return null;
  // openai SDK throws APIError-shaped objects with `.status` + `.error` body.
  if (typeof e === "object" && "status" in e && (e as { status: unknown }).status === 402) {
    const body =
      (e as { error?: unknown; body?: unknown; response?: unknown }).error ??
      (e as { body?: unknown }).body ??
      (e as { response?: unknown }).response;
    const detail = extractDetail(body);
    if (detail) return detail;
  }
  // Generic Error with a message that smuggled the 402 body in. Covers both
  // pi-ai (errorMessage = openai SDK's `"402 Payment Required {...}"`) and
  // the Rust STT IPC (`"HTTP 402 from <url>: <json>"`).
  if (e instanceof Error || typeof e === "string") {
    const msg = e instanceof Error ? e.message : e;
    const m = msg.match(/\b402\b[^{]*({[\s\S]*})/);
    if (m) {
      try {
        return extractDetail(JSON.parse(m[1]));
      } catch {
        /* fall through */
      }
    }
    // Best-effort: any embedded object that mentions quota_kind.
    const j = msg.match(/{[\s\S]*?"quota_kind"[\s\S]*?}/);
    if (j) {
      try {
        return extractDetail(JSON.parse(j[0]));
      } catch {
        /* fall through */
      }
    }
  }
  return null;
}

function extractDetail(body: unknown): QuotaErrorBody | null {
  if (!body || typeof body !== "object") return null;
  // FastAPI wraps the route's `detail` as `{detail: {...}}`. Some paths unwrap.
  const inner =
    "detail" in body && typeof (body as { detail: unknown }).detail === "object"
      ? (body as { detail: object }).detail
      : body;
  if (inner && typeof inner === "object" && "quota_kind" in inner) {
    return inner as QuotaErrorBody;
  }
  return null;
}

/** Returns true if `e` was a recognised 402 and the user has now been notified. */
export function tryHandleQuotaError(e: unknown): boolean {
  const q = parseQuotaError(e);
  if (!q) return false;

  // Snap the Settings meter to its at-cap state without waiting for next refresh.
  void useSubscriptionStore.getState().refresh();

  // Push directly so we can pin a stable id — bursts of 402s from parallel
  // tool calls collapse into one toast instead of stacking.
  if (q.quota_kind === "pro_abuse") {
    useToastStore.getState().push({
      id: TOAST_ID,
      kind: "error",
      title: "AnySpace Pro fair-use limit reached",
      body: "Unusually high cloud usage detected — please reach out at hi@anyspace.dev.",
    });
    return true;
  }

  const kindLabel = q.quota_kind === "ai" ? "AI" : "speech-to-text";
  useToastStore.getState().push({
    id: TOAST_ID,
    kind: "error",
    title: `Free ${kindLabel} limit reached`,
    body: "Upgrade to Pro for unlimited cloud usage — or paste your own API key in Settings.",
    action: { label: "Upgrade", onClick: () => void doUpgrade() },
  });
  return true;
}

async function doUpgrade(): Promise<void> {
  try {
    const url = await startCheckout("monthly");
    await openExternal(url);
    useSubscriptionStore.getState().setPendingCheckout(true);
  } catch (err) {
    useToastStore.getState().push({
      kind: "error",
      title: "Couldn't open checkout",
      body: String(err),
    });
  }
}

// Re-export the toast id so call sites that prefer to push their own
// 402-aware toast can keep the same de-dup behavior.
export { TOAST_ID as QUOTA_TOAST_ID };
