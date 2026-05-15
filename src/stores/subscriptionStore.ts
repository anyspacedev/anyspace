import { create } from "zustand";

import { isSignedIn } from "../lib/auth";
import {
  fetchLicense,
  fetchUsage,
  refreshLicense,
  type LicenseState,
  type UsageState,
} from "../lib/billingApi";

/**
 * Subscription + usage state for the current user.
 *
 * Unlike the settings stores, this is NOT persisted to Tauri — the backend
 * (`/v1/license` + `/v1/usage`) is the source of truth. `load()`/`refresh()`
 * no-op while signed out so callers don't have to guard.
 *
 * Usage is fetched in parallel with license so the Settings meter renders
 * without a second round-trip. It's also re-fetched on any 402 (via
 * `lib/quotaError.ts`) so the meter snaps to "limit reached" the moment the
 * user hits the cap from inside the app.
 *
 * `pendingCheckout` is set when the user opens Stripe Checkout in their
 * browser; the window-focus handler in `App.tsx` polls `refresh()` while it's
 * set (the webhook that flips the plan to Pro may lag the user's return).
 */
type SubscriptionState = {
  license: LicenseState | null;
  usage: UsageState | null;
  loading: boolean;
  error: string | null;
  pendingCheckout: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setPendingCheckout: (pending: boolean) => void;
};

async function fetchInto(
  set: (partial: Partial<SubscriptionState>) => void,
  licFn: () => Promise<LicenseState>,
): Promise<void> {
  if (!isSignedIn()) {
    set({ license: null, usage: null, error: null, loading: false });
    return;
  }
  set({ loading: true, error: null });
  try {
    // Parallel — usage is read-only and cheap; one round-trip's worth of latency
    // beats a follow-up fetch on the Settings render path.
    const [license, usage] = await Promise.all([licFn(), fetchUsage()]);
    set({ license, usage, loading: false });
    if (license.plan === "pro") set({ pendingCheckout: false });
  } catch (e) {
    set({ error: String(e), loading: false });
  }
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  license: null,
  usage: null,
  loading: false,
  error: null,
  pendingCheckout: false,
  load: () => fetchInto(set, fetchLicense),
  refresh: () => fetchInto(set, refreshLicense),
  setPendingCheckout: (pendingCheckout) => set({ pendingCheckout }),
}));
