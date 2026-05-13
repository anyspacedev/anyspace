import { useEffect, useState } from "react";
import {
  useBackgroundProposalsStore,
  isWriteSensitive,
} from "../../stores/backgroundProposalsStore";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { useSuperAgentSettingsStore } from "../../stores/superAgentSettingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { ensureBackgroundSession, subscribeWatcherStatus } from "../../lib/backgroundWatcher";

/**
 * Status-bar pill summarising pending background-watcher proposals.
 *
 * Hidden when 0 — keeps the chrome quiet. Click opens the SA rail and
 * switches to the Background Watcher session. Pulses once on arrival;
 * shows an inline tick-in-flight indicator while the watcher is calling
 * the AI provider.
 */
export function BackgroundProposalsPill() {
  const proposals = useBackgroundProposalsStore((s) => s.proposals);
  const pending = proposals.filter((p) => p.status === "pending");
  const count = pending.length;
  const setPanelOpen = useSuperAgentStore((s) => s.setPanelOpen);
  const setActiveSession = useSuperAgentStore((s) => s.setActiveSession);
  const setView = useWorkspaceStore((s) => s.setView);
  const enabled = useSuperAgentSettingsStore(
    (s) => s.settings.backgroundEnabled !== false,
  );

  const [pulseKey, setPulseKey] = useState(0);
  const [running, setRunning] = useState(false);
  const [lastCount, setLastCount] = useState(count);

  useEffect(() => {
    if (count > lastCount) setPulseKey((k) => k + 1);
    setLastCount(count);
  }, [count, lastCount]);

  useEffect(() => subscribeWatcherStatus((r) => setRunning(r)), []);

  if (!enabled || count === 0) return null;

  const hasSensitiveLowConfidence = pending.some(
    (p) => p.confidence === "low" && isWriteSensitive(p.kind),
  );

  const label = `${count} pending background-agent proposal${count === 1 ? "" : "s"}; open watcher`;

  const onClick = async () => {
    try {
      const sessionId = await ensureBackgroundSession();
      setActiveSession(sessionId);
    } catch {
      /* best-effort */
    }
    setPanelOpen(true);
    setView("workspace");
  };

  return (
    <button
      type="button"
      className={
        "status-proposals-badge" +
        (hasSensitiveLowConfidence ? " warn" : "") +
        (running ? " running" : "")
      }
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <span
        className="status-proposals-dot"
        key={pulseKey}
        aria-hidden="true"
      />
      {count} proposal{count === 1 ? "" : "s"}
      {running && <span className="status-proposals-spinner" aria-hidden="true" />}
    </button>
  );
}
