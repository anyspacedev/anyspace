import { create } from "zustand";
import { browserHide, browserShow } from "../lib/tauri";

/**
 * Child WebViews on Linux/WebKitGTK and Windows/WebView2 are always rendered
 * on top of the main WebView — modals (Settings, dialogs, autocomplete
 * dropdowns, command palette) opened in the main WebView are otherwise
 * occluded by every browser pane. This store coordinates a global
 * "hide depth": any modal-style owner calls pushHide() on open and popHide()
 * on close. Whenever depth flips between 0 and >0, every registered browser
 * pane is told to hide or show.
 *
 * Per-pane register() is called by BrowserPane's mount effect; the store
 * remembers paneIds so it can fan visibility changes out without the panes
 * subscribing individually.
 */

type State = {
  hideDepth: number;
  panes: string[];
};

type Actions = {
  registerPane: (paneId: string) => void;
  unregisterPane: (paneId: string) => void;
  pushHide: () => void;
  popHide: () => void;
};

export const useBrowserVisibilityStore = create<State & Actions>((set, get) => ({
  hideDepth: 0,
  panes: [],

  registerPane: (paneId) => {
    const list = get().panes;
    if (list.includes(paneId)) return;
    set({ panes: [...list, paneId] });
    // If a modal is already open at register time, hide this pane immediately.
    if (get().hideDepth > 0) {
      void browserHide(paneId).catch(() => {});
    }
  },

  unregisterPane: (paneId) => {
    set({ panes: get().panes.filter((p) => p !== paneId) });
  },

  pushHide: () => {
    const prev = get().hideDepth;
    set({ hideDepth: prev + 1 });
    if (prev === 0) {
      for (const paneId of get().panes) {
        void browserHide(paneId).catch(() => {});
      }
    }
  },

  popHide: () => {
    const prev = get().hideDepth;
    if (prev <= 0) return;
    set({ hideDepth: prev - 1 });
    if (prev === 1) {
      for (const paneId of get().panes) {
        void browserShow(paneId).catch(() => {});
      }
    }
  },
}));
