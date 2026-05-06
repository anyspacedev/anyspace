import { create } from "zustand";

/**
 * Reactive mirror of Clerk auth state.
 *
 * The non-React imperative API in `lib/auth.ts` (used by Zustand stores like
 * sttStore that need to mint a JWT outside the React tree) writes here as well,
 * so any component can subscribe with `useAuthStore(s => s.signedIn)` and
 * re-render on sign-in/sign-out.
 *
 * `clerkConfigured` lets the UI render an honest "this build wasn't compiled
 * with a Clerk key" message instead of a perpetual sign-in spinner.
 */
export type AuthState = {
  ready: boolean;
  signedIn: boolean;
  email: string | null;
  clerkConfigured: boolean;
};

export const useAuthStore = create<AuthState>(() => ({
  ready: false,
  signedIn: false,
  email: null,
  clerkConfigured: !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
}));
