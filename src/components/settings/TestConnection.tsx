import { useState } from "react";
import { probeAiEndpoint, type ProbeResult } from "../../lib/settings/probe";
import { Icon } from "../ui/Icon";

/**
 * Inline "Test connection" button. Round-trips the AI endpoint with a tiny
 * chat call and renders ✓ / ✗ + duration / error inline so the user gets
 * feedback without leaving the form.
 */
export function TestAiConnection({
  endpoint,
  apiKey,
  model,
}: {
  endpoint: string;
  apiKey: string;
  model: string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProbeResult | null>(null);

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await probeAiEndpoint({ endpoint, apiKey, model });
      setResult(r);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="probe-row">
      <button
        type="button"
        className="btn btn-ghost btn-with-icon"
        onClick={run}
        disabled={busy}
      >
        {busy ? (
          <>
            <span className="btn-spinner" />
            <span>Testing…</span>
          </>
        ) : (
          <>
            <Icon name="check" size={12} />
            <span>Test connection</span>
          </>
        )}
      </button>
      {result && (
        <span
          className={"probe-result " + (result.ok ? "probe-ok" : "probe-fail")}
          role="status"
          aria-live="polite"
        >
          <Icon name={result.ok ? "check" : "alert-circle"} size={12} />
          <span>{result.message}</span>
        </span>
      )}
    </div>
  );
}
