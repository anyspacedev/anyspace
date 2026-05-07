import { create } from "zustand";

export type ToastKind = "info" | "success" | "error" | "warn";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type Toast = {
  id: string;
  kind: ToastKind;
  title: string;
  body?: string;
  action?: ToastAction;
  /** Auto-dismiss after this many ms. Undefined / 0 = sticky. */
  ttlMs?: number;
  createdAt: number;
};

const newId = () => Math.random().toString(36).slice(2, 10);

const DEFAULT_TTL: Record<ToastKind, number | undefined> = {
  info: 4000,
  success: 2500,
  warn: 6000,
  // Errors stick until dismissed — they almost always need a user action.
  error: undefined,
};

type ToastInput = Omit<Toast, "id" | "createdAt"> & { id?: string };

type ToastState = {
  toasts: Toast[];
  push: (t: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
};

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (input) => {
    const id = input.id ?? newId();
    const ttl = input.ttlMs ?? DEFAULT_TTL[input.kind];
    const toast: Toast = {
      id,
      kind: input.kind,
      title: input.title,
      body: input.body,
      action: input.action,
      ttlMs: ttl,
      createdAt: Date.now(),
    };
    // De-dupe by explicit id: replace in place rather than stacking duplicates.
    set((s) => ({
      toasts: [...s.toasts.filter((t) => t.id !== id), toast],
    }));
    if (ttl && ttl > 0) {
      window.setTimeout(() => {
        // Only auto-dismiss if this exact instance is still mounted —
        // a manual dismiss/replace would have changed createdAt.
        const cur = get().toasts.find((t) => t.id === id);
        if (cur && cur.createdAt === toast.createdAt) get().dismiss(id);
      }, ttl);
    }
    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  clear: () => set({ toasts: [] }),
}));

/** Convenience helpers — keep call sites tight. */
export const toast = {
  info: (title: string, body?: string, action?: ToastAction) =>
    useToastStore.getState().push({ kind: "info", title, body, action }),
  success: (title: string, body?: string, action?: ToastAction) =>
    useToastStore.getState().push({ kind: "success", title, body, action }),
  warn: (title: string, body?: string, action?: ToastAction) =>
    useToastStore.getState().push({ kind: "warn", title, body, action }),
  error: (title: string, body?: string, action?: ToastAction) =>
    useToastStore.getState().push({ kind: "error", title, body, action }),
};
