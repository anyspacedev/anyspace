/**
 * Background Super Agent watcher — public surface.
 *
 * `start()` is idempotent; safe to call from React mount effects. `stop()`
 * tears down the timers and subscriptions. UI components subscribe to
 * `subscribeWatcherStatus` for the in-flight pill indicator.
 */

export { startTicker as start, stopTicker as stop } from "./ticker";
export {
  subscribeWatcherStatus,
  isWatcherRunning,
  getLastTickAt,
  bumpUserInteraction,
} from "./ticker";
export {
  ensureBackgroundSession,
  getBackgroundSessionId,
  isBackgroundSession,
} from "./session";
