import { create } from "zustand";

export type ScreenshotSource = "preview" | "mobile";

export type Screenshot = {
  id: string;
  path: string;
  dataUrl: string;
  source: ScreenshotSource;
  createdAt: number;
};

export type ScreenshotNotice = {
  id: string;
  kind: "error" | "info";
  message: string;
};

type State = {
  items: Screenshot[];
  notice: ScreenshotNotice | null;
  push: (s: { path: string; dataUrl: string; source: ScreenshotSource }) => void;
  remove: (id: string) => void;
  clear: () => void;
  setNotice: (n: { kind: "error" | "info"; message: string } | null) => void;
};

// Caps stack height ≈ 750 px on the default 900 px window so the column
// doesn't cover the status/tab bars when full.
const MAX_ITEMS = 6;

let nextId = 0;
const newId = () => `s${Date.now().toString(36)}-${(nextId++).toString(36)}`;

export const useScreenshotStore = create<State>((set) => ({
  items: [],
  notice: null,
  push: (s) =>
    set((state) => {
      const item: Screenshot = { ...s, id: newId(), createdAt: Date.now() };
      const next = [...state.items, item];
      if (next.length > MAX_ITEMS) next.splice(0, next.length - MAX_ITEMS);
      return { items: next };
    }),
  remove: (id) => set((state) => ({ items: state.items.filter((it) => it.id !== id) })),
  clear: () => set({ items: [] }),
  setNotice: (n) =>
    set({ notice: n ? { id: newId(), kind: n.kind, message: n.message } : null }),
}));
