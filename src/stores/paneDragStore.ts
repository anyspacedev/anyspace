import { create } from "zustand";

export type DropZone = "swap" | "top" | "right" | "bottom" | "left";

type State = {
  sourcePaneId: string | null;
  sourceTabId: string | null;
  targetPaneId: string | null;
  zone: DropZone | null;
};

type Actions = {
  start: (sourcePaneId: string, sourceTabId: string) => void;
  setTarget: (targetPaneId: string | null, zone: DropZone | null) => void;
  end: () => void;
};

const initial: State = {
  sourcePaneId: null,
  sourceTabId: null,
  targetPaneId: null,
  zone: null,
};

export const usePaneDragStore = create<State & Actions>((set) => ({
  ...initial,
  start: (sourcePaneId, sourceTabId) =>
    set({ sourcePaneId, sourceTabId, targetPaneId: null, zone: null }),
  setTarget: (targetPaneId, zone) => set({ targetPaneId, zone }),
  end: () => set(initial),
}));
