import { useState } from "react";
import { open as openExternal } from "@tauri-apps/plugin-shell";

import { useAuthStore } from "../../stores/authStore";
import { useSubscriptionStore } from "../../stores/subscriptionStore";
import { openPortal, startCheckout, type UsageState } from "../../lib/billingApi";
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
  const usage = useSubscriptionStore((s) => s.usage);
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

        {clerkConfigured && ready && signedIn && usage && (
          <UsageMeter usage={usage} />
        )}

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

/**
 * Two-bar usage meter. Pro users see only the "unlimited" pill — their internal
 * fair-use ceiling is deliberately not surfaced (per the business plan: Pro is
 * marketed as unlimited; the quiet 10K-call cap exists for abuse mitigation,
 * not as a feature to advertise).
 */
function UsageMeter({ usage }: { usage: UsageState }) {
  if (usage.plan === "pro") {
    return (
      <div className="stt-field">
        <span className="stt-field-label">Usage</span>
        <div className="stt-tc-account stt-tc-account-muted">
          AnySpace Pro — unlimited cloud AI &amp; STT.
        </div>
      </div>
    );
  }

  const aiPct = pct(usage.ai.used, usage.ai.limit);
  const sttPct = pct(usage.stt.used_sec, usage.stt.limit_sec);
  return (
    <div className="stt-field">
      <span className="stt-field-label">Usage</span>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <Bar
          label="AI calls"
          used={`${usage.ai.used} / ${usage.ai.limit}`}
          pct={aiPct}
        />
        <Bar
          label="Speech-to-text"
          used={`${formatSecs(usage.stt.used_sec)} / ${formatSecs(usage.stt.limit_sec)}`}
          pct={sttPct}
        />
        <span className="stt-field-hint">
          Resets {formatDate(usage.window_end)}. Upgrade for unlimited cloud usage
          — or use your own API key in the AI / STT sections (always free).
        </span>
      </div>
    </div>
  );
}

function Bar({ label, used, pct: p }: { label: string; used: string; pct: number }) {
  const atCap = p >= 100;
  return (
    <div>
      <div style={{
        display: "flex", justifyContent: "space-between",
        fontSize: 12, marginBottom: 4,
      }}>
        <span>{label}</span>
        <span style={{ opacity: 0.75 }}>{used}</span>
      </div>
      <div style={{
        height: 6, borderRadius: 3,
        background: "var(--color-border, rgba(127,127,127,0.2))",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${Math.min(100, Math.max(0, p))}%`,
          background: atCap
            ? "var(--color-danger, #d04848)"
            : "var(--color-accent, var(--color-primary, #6c8df0))",
          transition: "width 200ms ease",
        }} />
      </div>
    </div>
  );
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 0;
  return (used / limit) * 100;
}

function formatSecs(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}
