import { create } from "zustand";

/** Which feature opened the guide. Drives the modal headline + the
 *  "Use my own API key" link target. */
export type LoginGuideFeature = "ai-explain" | "super-agent";

type LoginGuideState = {
  open: boolean;
  feature: LoginGuideFeature | null;
  openGuide: (feature: LoginGuideFeature) => void;
  close: () => void;
};

export const useLoginGuideStore = create<LoginGuideState>((set) => ({
  open: false,
  feature: null,
  openGuide: (feature) => set({ open: true, feature }),
  close: () => set({ open: false, feature: null }),
}));

export function openLoginGuide(feature: LoginGuideFeature): void {
  useLoginGuideStore.getState().openGuide(feature);
}
