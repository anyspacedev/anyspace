/**
 * Token bridge between Clerk's React context and non-React code (Zustand
 * stores, Tauri IPC wrappers).
 *
 * Clerk's `useAuth().getToken()` is only available inside the React tree.
 * The STT store needs to mint a fresh JWT at transcribe time without
 * holding a React ref. main.tsx mounts a tiny <ClerkTokenBridge/> that
 * registers the getter into this module; everything else calls
 * `getAuthToken()` synchronously when it needs a Bearer for the backend.
 *
 * The same bridge mirrors signed-in state into `useAuthStore` so React
 * components can subscribe and re-render. This module is the single
 * imperative surface; the store is the reactive surface — both stay in sync.
 */

import { useAuthStore } from "../stores/authStore";

let _getToken: ((opts?: { skipCache?: boolean }) => Promise<string | null>) | null = null;

export function setTokenGetter(fn: typeof _getToken): void {
  _getToken = fn;
}

export function setSignedInState(signedIn: boolean, email: string | null): void {
  useAuthStore.setState({ signedIn, email });
}

export function setAuthReady(ready: boolean): void {
  useAuthStore.setState({ ready });
}

export function isSignedIn(): boolean {
  return useAuthStore.getState().signedIn;
}

export function currentEmail(): string | null {
  return useAuthStore.getState().email;
}

/** Returns a fresh Clerk JWT or null if signed out / Clerk not mounted. */
export async function getAuthToken(): Promise<string | null> {
  if (!_getToken) return null;
  try {
    return await _getToken({ skipCache: true });
  } catch {
    return null;
  }
}

export const ANYSPACE_CLOUD_URL: string =
  (import.meta.env.VITE_ANYSPACE_CLOUD_URL as string | undefined) ||
  "https://api.anyspace.dev/v1";
