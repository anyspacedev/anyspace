import { create } from "zustand";

import { isSignedIn } from "../lib/auth";
import {
  fetchLicense,
  refreshLicense,
  type LicenseState,
} from "../lib/billingApi";

/**
 * Subscription state for the current user.
 *
 * Unlike the settings stores, this is NOT persisted to Tauri — the backend
 * (`/v1/license`) is the source of truth. `load()`/`refresh()` no-op while
 * signed out so callers don't have to guard.
 *
 * `pendingCheckout` is set when the user opens Stripe Checkout in their
 * browser; the window-focus handler in `App.tsx` polls `refresh()` while it's
 * set (the webhook that flips the plan to Pro may lag the user's return).
 */
type SubscriptionState = {
  license: LicenseState | null;
  loading: boolean;
  error: string | null;
  pendingCheckout: boolean;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  setPendingCheckout: (pending: boolean) => void;
};

async function fetchInto(
  set: (partial: Partial<SubscriptionState>) => void,
  fn: () => Promise<LicenseState>,
): Promise<void> {
  if (!isSignedIn()) {
    set({ license: null, error: null, loading: false });
    return;
  }
  set({ loading: true, error: null });
  try {
    const license = await fn();
    set({ license, loading: false });
    if (license.plan === "pro") set({ pendingCheckout: false });
  } catch (e) {
    set({ error: String(e), loading: false });
  }
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  license: null,
  loading: false,
  error: null,
  pendingCheckout: false,
  load: () => fetchInto(set, fetchLicense),
  refresh: () => fetchInto(set, refreshLicense),
  setPendingCheckout: (pendingCheckout) => set({ pendingCheckout }),
}));
