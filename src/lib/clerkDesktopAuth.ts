/**
 * Desktop OAuth orchestrator.
 *
 * Pairs with `src-tauri/src/auth/mod.rs`. Flow:
 *   1. Subscribe to `desktop:auth:ticket` / `desktop:auth:error` events.
 *   2. Call `desktopAuthBegin` — Rust binds 127.0.0.1:0, returns the port
 *      + a random nonce.
 *   3. Open the bridge URL in the user's default browser via plugin-shell.
 *      Bridge defaults to the real anyspace.dev/desktop/sign-in page;
 *      `VITE_DESKTOP_AUTH_BRIDGE_URL` overrides it (e.g. to point at a
 *      local landing dev server).
 *   4. Await the `desktop:auth:ticket` event (or 130s timeout).
 *   5. Redeem the ticket via `signIn.create({ strategy: "ticket" })`, then
 *      `setActive({ session })`.
 *
 * Why the WebView OAuth modal can't do this on its own: WebKit ITP refuses
 * to persist Clerk's Set-Cookie on cross-site XHR, so the in-WebView OAuth
 * handshake's state cookie never lands and the callback to
 * `clerk.<host>/v1/oauth_callback` returns 403 `authorization_invalid`.
 * Routing OAuth through the real browser sidesteps ITP entirely; the
 * ticket-redeem call is a single Clerk XHR whose response (if cookie-blocked
 * by ITP) gracefully falls back to clerk-js's localStorage session.
 */

import { useCallback, useState } from "react";
import { useSignIn } from "@clerk/clerk-react";
import { open as openExternal } from "@tauri-apps/plugin-shell";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  desktopAuthBegin,
  desktopAuthCancel,
  type DesktopAuthErrorEvent,
  type DesktopAuthTicketEvent,
} from "./tauri";

/** Slightly longer than the Rust listener's 120s self-timeout so the
 *  Rust side reports first if the user just walks away. */
const OVERALL_TIMEOUT_MS = 130_000;

/** The real bridge page. Used unless `VITE_DESKTOP_AUTH_BRIDGE_URL`
 *  overrides it — e.g. to point at a local landing dev server, or back
 *  at the in-process `http://127.0.0.1:<port>/fake-bridge` stub the Rust
 *  listener still serves for smoke-testing loopback + event plumbing. */
const DEFAULT_BRIDGE_URL = "https://anyspace.dev/desktop/sign-in";

/** Override for the bridge page URL. Unset → `DEFAULT_BRIDGE_URL`. */
const BRIDGE_OVERRIDE: string | undefined =
  (import.meta.env.VITE_DESKTOP_AUTH_BRIDGE_URL as string | undefined) ||
  undefined;

/** Structural type for the bits of `useSignIn()`'s return value we use.
 *  Avoids a direct dependency on Clerk's internal type paths, which move
 *  between minor versions. */
export type DesktopSignInDeps = {
  signIn: {
    create: (params: {
      strategy: "ticket";
      ticket: string;
    }) => Promise<{ status: string; createdSessionId: string | null }>;
  };
  setActive: (params: { session: string }) => Promise<void>;
};

export type DesktopSignInOptions = {
  provider?: "google" | "github" | "microsoft";
};

export async function desktopSignIn(
  deps: DesktopSignInDeps,
  options: DesktopSignInOptions = {},
): Promise<void> {
  const provider = options.provider ?? "google";

  // Subscribe BEFORE starting the listener / opening the browser. The
  // user can't physically click "Approve" in the time it takes Tauri to
  // attach two listeners, but the contract is cleaner this way.
  let resolveTicket!: (ticket: string) => void;
  let rejectError!: (error: Error) => void;
  const ticketPromise = new Promise<string>((res, rej) => {
    resolveTicket = res;
    rejectError = rej;
  });

  const unlistens: UnlistenFn[] = [];
  unlistens.push(
    await listen<DesktopAuthTicketEvent>("desktop:auth:ticket", (e) => {
      resolveTicket(e.payload.ticket);
    }),
  );
  unlistens.push(
    await listen<DesktopAuthErrorEvent>("desktop:auth:error", (e) => {
      rejectError(new Error(`desktop sign-in: ${e.payload.error}`));
    }),
  );

  try {
    const { port, nonce } = await desktopAuthBegin();
    const returnTo = `http://127.0.0.1:${port}/callback`;
    const bridgeBase = BRIDGE_OVERRIDE ?? DEFAULT_BRIDGE_URL;
    const url =
      `${bridgeBase}?return_to=${encodeURIComponent(returnTo)}` +
      `&nonce=${encodeURIComponent(nonce)}` +
      `&provider=${encodeURIComponent(provider)}`;

    await openExternal(url);

    const ticket = await withTimeout(ticketPromise, OVERALL_TIMEOUT_MS);

    const res = await deps.signIn.create({ strategy: "ticket", ticket });
    if (res.status !== "complete" || !res.createdSessionId) {
      throw new Error(
        `ticket redemption returned non-complete status: ${res.status}`,
      );
    }
    await deps.setActive({ session: res.createdSessionId });
  } catch (e) {
    // If we bailed before Rust got the callback (user closed the tab,
    // network glitch, timeout), make sure the listener tears down so
    // the port is freed and the next attempt starts clean.
    void desktopAuthCancel().catch(() => {});
    throw e;
  } finally {
    for (const u of unlistens) u();
  }
}

/** Shared hook used by every Sign-In button. Pulls `signIn` + `setActive`
 *  from Clerk's hook, gates a single in-flight attempt with `busy`, and
 *  surfaces the last error. Each call site renders whatever button shape
 *  it wants and wires `start` to onClick.
 *
 *  Multiple parallel sign-in attempts are nonsensical (one open browser
 *  tab + one loopback port), so `start` is a no-op while `busy` is true. */
export type UseDesktopSignIn = {
  isLoaded: boolean;
  busy: boolean;
  error: Error | null;
  start: () => Promise<void>;
};

export function useDesktopSignIn(
  provider?: "google" | "github" | "microsoft",
): UseDesktopSignIn {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const start = useCallback(async () => {
    if (!isLoaded || !signIn || !setActive || busy) return;
    setBusy(true);
    setError(null);
    try {
      await desktopSignIn(
        // useSignIn's types are wider than what desktopSignIn declares;
        // the structural type accepts them at runtime. Cast keeps tsc happy
        // without pulling Clerk's internal type paths into this module.
        {
          signIn: signIn as unknown as DesktopSignInDeps["signIn"],
          setActive: setActive as unknown as DesktopSignInDeps["setActive"],
        },
        provider ? { provider } : {},
      );
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      setError(err);
      // Surface in devtools — call sites can also display `error` inline.
      console.error("[desktop sign-in]", err);
    } finally {
      setBusy(false);
    }
  }, [isLoaded, signIn, setActive, busy, provider]);

  return { isLoaded, busy, error, start };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(
      () => reject(new Error("desktop sign-in: timeout waiting for callback")),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
