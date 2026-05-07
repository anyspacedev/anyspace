import { create } from "zustand";

/**
 * Global "picker is active" surface, so chrome (mode strip) can show a chip
 * even though the picker state itself is owned by an individual PreviewPane.
 *
 * One picker at a time: starting a new one replaces the previous cancel
 * callback. Cancelling drives the registered callback, which in turn flips
 * the local pane state back off.
 */
type PickerState = {
  active: boolean;
  paneId: string | null;
  cancelFn: (() => void) | null;
  setActive: (paneId: string, cancel: () => void) => void;
  clear: (paneId: string) => void;
  cancel: () => void;
};

export const usePickerStore = create<PickerState>((set, get) => ({
  active: false,
  paneId: null,
  cancelFn: null,

  setActive: (paneId, cancel) => set({ active: true, paneId, cancelFn: cancel }),

  // Only clear if the current owner is releasing — prevents a stale unmount
  // from clobbering a newer picker.
  clear: (paneId) => {
    if (get().paneId !== paneId) return;
    set({ active: false, paneId: null, cancelFn: null });
  },

  cancel: () => {
    const { cancelFn } = get();
    if (cancelFn) cancelFn();
    set({ active: false, paneId: null, cancelFn: null });
  },
}));
