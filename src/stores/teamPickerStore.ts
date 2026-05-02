import { create } from "zustand";

/** Tiny ephemeral store for the team-picker modal so the welcome card button,
 * TabBar "+ Team" trigger, and Cmd+Shift+T shortcut all open the same modal. */
type TeamPickerState = {
  open: boolean;
  setOpen: (open: boolean) => void;
};

export const useTeamPickerStore = create<TeamPickerState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
