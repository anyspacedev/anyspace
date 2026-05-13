/**
 * Background watcher scheduler.
 *
 * Fires `tick()` on three triggers:
 *  - 90s heartbeat (setInterval)
 *  - kanban store mutations
 *  - workspace store mutations
 *
 * All three feed a 5s debounce so bursts of changes coalesce into one tick.
 * A mutex prevents overlapping runs; only one pending run is queued at a
 * time — further triggers collapse into the queued one.
 *
 * Per-tick guards skip when: AI creds unconfigured, user is actively
 * interacting with the SA panel, last tick was < 30s ago (heartbeat only),
 * or the watcher is disabled in settings. On rate-limit / quota errors,
 * back off exponentially up to 30 min.
 */

import { sendUserMessageViaPi } from "../superAgent/panelBridge";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useSuperAgentSettingsStore } from "../../stores/superAgentSettingsStore";
import { resolveAiCreds } from "../cloudCredentials";
import { useAiStore } from "../../stores/aiStore";
import { ensureBackgroundSession } from "./session";
import {
  buildObservation,
  diffsSinceLastTick,
  resetWatcherMemory,
  type ObservationTrigger,
} from "./observation";

const HEARTBEAT_MS = 90_000;
const DEBOUNCE_MS = 5_000;
const HEARTBEAT_MIN_GAP_MS = 30_000;
const USER_ACTIVITY_QUIET_MS = 10_000;
const MAX_BACKOFF_MS = 30 * 60_000;

type WatcherState = {
  heartbeatTimer: number | null;
  debounceTimer: number | null;
  pendingTrigger: ObservationTrigger | null;
  inFlight: boolean;
  queuedTrigger: ObservationTrigger | null;
  lastTickAt: number;
  lastInteractionAt: number;
  backoffUntil: number;
  unsubscribeFns: Array<() => void>;
  started: boolean;
};

const state: WatcherState = {
  heartbeatTimer: null,
  debounceTimer: null,
  pendingTrigger: null,
  inFlight: false,
  queuedTrigger: null,
  lastTickAt: 0,
  lastInteractionAt: 0,
  backoffUntil: 0,
  unsubscribeFns: [],
  started: false,
};

const listeners = new Set<(running: boolean, lastTickAt: number) => void>();

function notifyListeners(): void {
  for (const fn of listeners) fn(state.inFlight, state.lastTickAt);
}

/** Subscribe to in-flight / last-tick changes. Returns unsubscribe. */
export function subscribeWatcherStatus(
  cb: (running: boolean, lastTickAt: number) => void,
): () => void {
  listeners.add(cb);
  cb(state.inFlight, state.lastTickAt);
  return () => listeners.delete(cb);
}

export function isWatcherRunning(): boolean {
  return state.inFlight;
}

export function getLastTickAt(): number {
  return state.lastTickAt;
}

/** Bump the "user is interacting with SA" timestamp. The SA panel calls this
 *  on textarea input / send. */
export function bumpUserInteraction(): void {
  state.lastInteractionAt = Date.now();
}

export function startTicker(): void {
  if (state.started) return;
  state.started = true;
  resetWatcherMemory();

  let lastKanbanRef = useKanbanStore.getState().tasks;
  const kanbanUnsub = useKanbanStore.subscribe((s) => {
    if (s.tasks !== lastKanbanRef) {
      lastKanbanRef = s.tasks;
      scheduleTick("kanban");
    }
  });
  let lastTabsRef = useWorkspaceStore.getState().tabs;
  const wsUnsub = useWorkspaceStore.subscribe((s) => {
    if (s.tabs !== lastTabsRef) {
      lastTabsRef = s.tabs;
      scheduleTick("workspace");
    }
  });
  state.unsubscribeFns.push(kanbanUnsub, wsUnsub);

  state.heartbeatTimer = window.setInterval(() => {
    scheduleTick("heartbeat");
  }, HEARTBEAT_MS);
}

export function stopTicker(): void {
  if (!state.started) return;
  state.started = false;
  if (state.heartbeatTimer != null) {
    window.clearInterval(state.heartbeatTimer);
    state.heartbeatTimer = null;
  }
  if (state.debounceTimer != null) {
    window.clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  for (const fn of state.unsubscribeFns) {
    try {
      fn();
    } catch {
      /* best-effort */
    }
  }
  state.unsubscribeFns = [];
  state.pendingTrigger = null;
  state.queuedTrigger = null;
  resetWatcherMemory();
}

function scheduleTick(trigger: ObservationTrigger): void {
  if (!useSuperAgentSettingsStore.getState().settings.backgroundEnabled) return;
  if (state.debounceTimer != null) {
    // A debounce window is already running — keep the most informative
    // trigger ("kanban" / "workspace" beats "heartbeat").
    if (state.pendingTrigger === "heartbeat" && trigger !== "heartbeat") {
      state.pendingTrigger = trigger;
    }
    return;
  }
  state.pendingTrigger = trigger;
  state.debounceTimer = window.setTimeout(() => {
    state.debounceTimer = null;
    const t = state.pendingTrigger ?? "heartbeat";
    state.pendingTrigger = null;
    void tick(t);
  }, DEBOUNCE_MS);
}

async function tick(trigger: ObservationTrigger): Promise<void> {
  const now = Date.now();
  if (now < state.backoffUntil) return;

  const settings = useSuperAgentSettingsStore.getState().settings;
  if (!settings.backgroundEnabled) return;

  if (trigger === "heartbeat" && now - state.lastTickAt < HEARTBEAT_MIN_GAP_MS) {
    return;
  }
  if (now - state.lastInteractionAt < USER_ACTIVITY_QUIET_MS) {
    return;
  }

  // Verify AI creds without throwing — silently no-op when missing so the
  // watcher reactivates the moment the user finishes Settings → AI.
  const ai = useAiStore.getState().settings;
  const presetId = settings.presetId === "inherit" ? ai.presetId : settings.presetId;
  const fallback = {
    endpoint: settings.endpoint || ai.endpoint,
    apiKey: settings.apiKey || ai.apiKey,
    model: settings.model || ai.model,
  };
  const creds = await resolveAiCreds(presetId, fallback);
  if (!creds.ok) return;

  if (state.inFlight) {
    // Collapse into a single queued tick — prefer the more informative
    // trigger over "heartbeat".
    if (!state.queuedTrigger || state.queuedTrigger === "heartbeat") {
      state.queuedTrigger = trigger;
    }
    return;
  }

  state.inFlight = true;
  notifyListeners();

  try {
    const sessionId = await ensureBackgroundSession();
    const observation = buildObservation(trigger);
    if (!diffsSinceLastTick(observation) && trigger === "heartbeat") {
      // Window state hasn't changed since last heartbeat — saves a call.
      state.lastTickAt = Date.now();
      return;
    }

    const userText = formatObservation(observation);
    // Route through panelBridge so the v1 super_agent_messages table sees the
    // user + assistant rows — keeps the Background Watcher transcript
    // readable when the user switches to that session in the SA panel.
    await sendUserMessageViaPi(sessionId, userText, { mode: "background" });
    state.lastTickAt = Date.now();
    state.backoffUntil = 0;
  } catch (err) {
    handleTickError(err);
  } finally {
    state.inFlight = false;
    notifyListeners();
    const queued = state.queuedTrigger;
    state.queuedTrigger = null;
    if (queued) {
      scheduleTick(queued);
    }
  }
}

function formatObservation(obs: ReturnType<typeof buildObservation>): string {
  // Compact JSON keeps the payload under the cap; the SA model is fine
  // reading minified JSON.
  return (
    `Observation tick (trigger=${obs.trigger}): ${JSON.stringify(obs)}\n\n` +
    `What in this window needs attention? Use \`propose_action\` for anything actionable, or stay silent. ` +
    `Skip status changes you've already proposed in this session.`
  );
}

function handleTickError(err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  const isRateLimited =
    /rate.?limit|quota|429|insufficient_quota/i.test(msg) ||
    /503/.test(msg);
  if (isRateLimited) {
    const prev = state.backoffUntil - Date.now();
    const next = Math.min(MAX_BACKOFF_MS, Math.max(60_000, prev > 0 ? prev * 2 : 60_000));
    state.backoffUntil = Date.now() + next;
  }
  // eslint-disable-next-line no-console
  console.warn("[backgroundWatcher] tick failed:", msg);
}
