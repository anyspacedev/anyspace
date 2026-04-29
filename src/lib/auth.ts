/**
 * Token bridge between Clerk's React context and non-React code (Zustand
 * stores, Tauri IPC wrappers).
 *
 * Clerk's `useAuth().getToken()` is only available inside the React tree.
 * The STT store needs to mint a fresh JWT at transcribe time without
 * holding a React ref. main.tsx mounts a tiny <ClerkTokenBridge/> that
 * registers the getter into this module; everything else calls
 * `getAuthToken()` synchronously when it needs a Bearer for the backend.
 */

let _getToken: ((opts?: { skipCache?: boolean }) => Promise<string | null>) | null = null;
let _userEmail: string | null = null;
let _signedIn = false;

export function setTokenGetter(fn: typeof _getToken): void {
  _getToken = fn;
}

export function setSignedInState(signedIn: boolean, email: string | null): void {
  _signedIn = signedIn;
  _userEmail = email;
}

export function isSignedIn(): boolean {
  return _signedIn;
}

export function currentEmail(): string | null {
  return _userEmail;
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

export const TEAMSHIP_CLOUD_URL: string =
  (import.meta.env.VITE_TEAMSHIP_CLOUD_URL as string | undefined) ?? "";
