import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";

import { useAuthStore } from "../../stores/authStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { openPortal, startCheckout } from "../../lib/billingApi";
import { toast } from "../../stores/toastStore";
import { AnySpaceCloudAccount } from "../auth/AnySpaceCloudAccount";

/**
 * Subscription / billing settings section.
 *
 * Plan state comes from `/v1/license` (subscriptionStore); the "Upgrade" and
 * "Manage" buttons open hosted Stripe pages in the system browser. There is
 * no deep link back — `App.tsx` re-checks the license on window focus while
 * a checkout is pending.
 */
export function SubscriptionSection() {
  const ready = useAuthStore((s) => s.ready);
  const signedIn = useAuthStore((s) => s.signedIn);
  const clerkConfigured = useAuthStore((s) => s.clerkConfigured);

  const license = useSubscriptionStore((s) => s.license);
  const loading = useSubscriptionStore((s) => s.loading);
  const error = useSubscriptionStore((s) => s.error);
  const pendingCheckout = useSubscriptionStore((s) => s.pendingCheckout);
  const refresh = useSubscriptionStore((s) => s.refresh);
  const setPendingCheckout = useSubscriptionStore((s) => s.setPendingCheckout);

  const [busy, setBusy] = useState(false);

  const onUpgrade = async () => {
    setBusy(true);
    try {
      const url = await startCheckout("monthly");
      await openExternal(url);
      setPendingCheckout(true);
    } catch (e) {
      toast.error("Couldn't start checkout", String(e));
    } finally {
      setBusy(false);
    }
  };

  const onManage = async () => {
    setBusy(true);
    try {
      const url = await openPortal();
      await openExternal(url);
    } catch (e) {
      toast.error("Couldn't open billing portal", String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Subscription</h2>
        <div className="settings-section-sub">
          AnySpace Pro unlocks the cloud AI features. Billing is handled by
          Stripe — checkout and subscription management open in your browser.
        </div>
      </div>

      <div className="stt-form">
        <div className="stt-field">
          <span className="stt-field-label">Account</span>
          <AnySpaceCloudAccount />
        </div>

        {clerkConfigured && ready && signedIn && (
          <div className="stt-field">
            <span className="stt-field-label">Plan</span>
            {license == null ? (
              loading ? (
                <div className="stt-tc-account stt-tc-account-muted">
                  Loading subscription…
                </div>
              ) : (
                <div className="stt-tc-account">
                  <span>{error ? `Couldn't load plan: ${error}` : "Plan unknown."}</span>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void refresh()}
                  >
                    Retry
                  </button>
                </div>
              )
            ) : license.plan === "pro" ? (
              <div className="stt-tc-account">
                <span>
                  <strong>AnySpace Pro</strong>
                  {license.current_period_end && (
                    <>
                      {" — "}
                      {license.cancel_at_period_end ? "cancels" : "renews"} on{" "}
                      {formatDate(license.current_period_end)}
                    </>
                  )}
                  {license.status && license.status !== "active" && (
                    <span className="stt-field-hint"> ({license.status})</span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => void onManage()}
                >
                  {busy ? "Opening…" : "Manage subscription"}
                </button>
              </div>
            ) : (
              <div className="stt-tc-account">
                <span>
                  You're on <strong>AnySpace Free</strong>.
                  {pendingCheckout && (
                    <span className="stt-field-hint">
                      {" "}Finishing your subscription…
                    </span>
                  )}
                </span>
                {pendingCheckout ? (
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void refresh()}
                  >
                    Refresh
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busy}
                    onClick={() => void onUpgrade()}
                  >
                    {busy ? "Opening browser…" : "Upgrade to Pro"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
