import { create } from "zustand";

import type { UpdaterState } from "../lib/updater";

/**
 * Reactive mirror of the current updater state.
 *
 * Not persisted — restarting the app re-runs `checkForUpdate()` from scratch.
 * `manuallyTriggered` lets the status-bar pill suppress its "Check now"
 * affordance while the user-initiated check is mid-flight (avoids double-fire).
 */
type Store = {
  state: UpdaterState;
  manuallyTriggered: boolean;
  set: (s: UpdaterState) => void;
  setManuallyTriggered: (v: boolean) => void;
};

export const useUpdaterStore = create<Store>((set) => ({
  state: { phase: "idle" },
  manuallyTriggered: false,
  set: (s) => set({ state: s }),
  setManuallyTriggered: (v) => set({ manuallyTriggered: v }),
}));
