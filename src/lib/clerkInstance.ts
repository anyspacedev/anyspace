/**
 * Clerk runs inside the Tauri webview at http://localhost:1420, which is
 * cross-site to the production Frontend API at clerk.anyspace.dev. Clerk's
 * session cookies are SameSite=Lax, so the browser never sends them on the
 * cross-site XHRs clerk-js makes (session `touch`, token refresh) — every
 * such call 401s and clerk-js signs the user out a few seconds after login.
 *
 * Fix: run clerk-js in native mode, the same mode @clerk/clerk-expo uses.
 * `standardBrowser: false` (set on <ClerkProvider> in main.tsx) stops it
 * depending on cookies; the two `__unstable__` hooks below are a direct port
 * of clerk-expo's token-cache wiring — they carry the client JWT in the
 * Authorization header and persist it in localStorage between requests.
 */
import { Clerk } from "@clerk/clerk-js";

const CLIENT_JWT_KEY = "__clerk_client_jwt";

export function createClerkInstance(publishableKey: string): Clerk {
  const clerk = new Clerk(publishableKey);

  clerk.__unstable__onBeforeRequest((requestInit) => {
    // The Authorization header is the sole credential in native mode —
    // don't also send the (cross-site-blocked) cookies.
    requestInit.credentials = "omit";
    requestInit.url?.searchParams.append("_is_native", "1");
    const jwt = localStorage.getItem(CLIENT_JWT_KEY);
    (requestInit.headers as Headers).set("authorization", jwt ?? "");
  });

  clerk.__unstable__onAfterResponse((_request, response) => {
    const authHeader = response?.headers.get("authorization");
    if (authHeader) localStorage.setItem(CLIENT_JWT_KEY, authHeader);
  });

  return clerk;
}
