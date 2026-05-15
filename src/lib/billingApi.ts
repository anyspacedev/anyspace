/**
 * Billing API client — talks to the AnySpace Cloud backend's /v1/billing/*
 * and /v1/license endpoints.
 *
 * Unlike STT/AI traffic (Tauri IPC) these are plain JSON calls, so we
 * `fetch` straight from the webview with a fresh Clerk Bearer JWT — the
 * backend CORS allows `tauri://localhost`, and this mirrors the
 * mint-a-JWT-per-call pattern in `cloudCredentials.ts`. Only the
 * external-browser hop for Checkout/Portal goes through Tauri.
 *
 * `ANYSPACE_CLOUD_URL` already includes the `/v1` suffix.
 */

import { ANYSPACE_CLOUD_URL, getAuthToken, isSignedIn } from "./auth";

export type LicenseState = {
  plan: "free" | "pro";
  active: boolean;
  status?: string;
  current_period_end: string | null;
  cancel_at_period_end?: boolean;
};

export type UsageState = {
  plan: "free" | "pro";
  window_start: string;            // ISO-Z
  window_end: string;
  ai: { used: number; limit: number; kind: "ai" };
  stt: { used_sec: number; limit_sec: number; kind: "stt" };
};

export type CheckoutInterval = "monthly" | "annual";

export class BillingApiError extends Error {}

async function authedFetch(
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<unknown> {
  if (!isSignedIn()) {
    throw new BillingApiError("not signed in");
  }
  const token = await getAuthToken();
  if (!token) {
    throw new BillingApiError("could not mint an auth token");
  }
  let resp: Response;
  try {
    resp = await fetch(`${ANYSPACE_CLOUD_URL}${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new BillingApiError(`network error: ${String(e)}`);
  }
  if (!resp.ok) {
    let detail = `${resp.status}`;
    try {
      const j = (await resp.json()) as { detail?: string };
      if (j?.detail) detail = j.detail;
    } catch {
      /* non-JSON body — keep the status code */
    }
    throw new BillingApiError(detail);
  }
  return resp.json();
}

/** Current subscription state. */
export async function fetchLicense(): Promise<LicenseState> {
  return authedFetch("/license") as Promise<LicenseState>;
}

/** Force a re-read of subscription state (same shape as `fetchLicense`). */
export async function refreshLicense(): Promise<LicenseState> {
  return authedFetch("/license/refresh", { method: "POST" }) as Promise<LicenseState>;
}

/** Current quota window + usage. Feeds the Settings → Subscription meter. */
export async function fetchUsage(): Promise<UsageState> {
  return authedFetch("/usage") as Promise<UsageState>;
}

/** Start a Stripe Checkout session; returns the hosted checkout URL. */
export async function startCheckout(
  interval: CheckoutInterval = "monthly",
): Promise<string> {
  const out = (await authedFetch("/billing/checkout", {
    method: "POST",
    body: { interval },
  })) as { url?: string };
  if (!out?.url) throw new BillingApiError("checkout response missing url");
  return out.url;
}

/** Open the Stripe Billing Portal; returns the hosted portal URL. */
export async function openPortal(): Promise<string> {
  const out = (await authedFetch("/billing/portal", { method: "POST" })) as {
    url?: string;
  };
  if (!out?.url) throw new BillingApiError("portal response missing url");
  return out.url;
}
