/**
 * Background Super Agent session lifecycle.
 *
 * The watcher owns a dedicated SA session named "Background Watcher" so its
 * transcript stays out of the user's chat sessions. Identification is by
 * stored id only — no schema change to `super_agent_sessions`.
 */

import { useSuperAgentStore } from "../../stores/superAgentStore";
import { useSuperAgentSettingsStore } from "../../stores/superAgentSettingsStore";

const SESSION_NAME = "Background Watcher";

let pendingEnsure: Promise<string> | null = null;

/** Resolve the background session id, creating the session if it doesn't
 *  exist or if the stored id has been deleted out from under us. Concurrent
 *  calls share the same in-flight promise so we never create two
 *  "Background Watcher" rows during a race. */
export async function ensureBackgroundSession(): Promise<string> {
  if (pendingEnsure) return pendingEnsure;
  // NOTE: the `finally` that clears `pendingEnsure` MUST be attached via
  // `.finally()` on the resolved promise, not inside the IIFE body. When the
  // IIFE has no awaits (the early-return-via-stored path), its body runs to
  // completion BEFORE the outer `pendingEnsure = …` assignment, so an
  // inside-the-IIFE `finally { pendingEnsure = null }` is immediately
  // shadowed by that outer assignment, leaving the cache permanently sticky.
  const promise = (async () => {
    const stored =
      useSuperAgentSettingsStore.getState().settings.backgroundSessionId;
    if (stored) {
      const exists = useSuperAgentStore
        .getState()
        .sessions.some((s) => s.id === stored);
      if (exists) return stored;
    }

    // Reuse a session that already carries the watcher name (handles old
    // installs where backgroundSessionId wasn't stamped yet).
    const existing = useSuperAgentStore
      .getState()
      .sessions.find((s) => s.name === SESSION_NAME);
    if (existing) {
      await useSuperAgentSettingsStore
        .getState()
        .update({ backgroundSessionId: existing.id });
      return existing.id;
    }

    const session = await useSuperAgentStore
      .getState()
      .createSession(SESSION_NAME);
    await useSuperAgentSettingsStore
      .getState()
      .update({ backgroundSessionId: session.id });
    return session.id;
  })();
  pendingEnsure = promise;
  promise.finally(() => {
    if (pendingEnsure === promise) pendingEnsure = null;
  });
  return promise;
}

export function getBackgroundSessionId(): string | null {
  return useSuperAgentSettingsStore.getState().settings.backgroundSessionId ?? null;
}

export function isBackgroundSession(sessionId: string | null): boolean {
  if (!sessionId) return false;
  return getBackgroundSessionId() === sessionId;
}
