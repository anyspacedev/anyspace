import { create } from "zustand";

export type NewWorkspacePickerMode = "menu" | "quick" | "team" | "saved";

type State = {
  open: boolean;
  mode: NewWorkspacePickerMode;
  openWith: (mode: NewWorkspacePickerMode) => void;
  setMode: (mode: NewWorkspacePickerMode) => void;
  close: () => void;
};

export const useNewWorkspacePickerStore = create<State>((set) => ({
  open: false,
  mode: "menu",
  openWith: (mode) => set({ open: true, mode }),
  setMode: (mode) => set({ mode }),
  close: () => set({ open: false, mode: "menu" }),
}));
