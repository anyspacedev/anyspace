import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/layout.css";
import "./styles/clerk.css";
import "./styles/knowledge.css";
import "@xterm/xterm/css/xterm.css";
import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { setAuthReady, setSignedInState, setTokenGetter } from "./lib/auth";
import { createClerkInstance } from "./lib/clerkInstance";
import { useThemeStore } from "./stores/themeStore";

const ua = navigator.userAgent;
document.documentElement.dataset.platform = /Mac|iPhone|iPad/.test(ua)
  ? "macos"
  : /Win/.test(ua)
    ? "windows"
    : "linux";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  | string
  | undefined;

/** Native-mode Clerk instance — constructed once at module load so its FAPI
 *  interceptors are registered before ClerkProvider calls `.load()`. */
const clerkInstance = PUBLISHABLE_KEY
  ? createClerkInstance(PUBLISHABLE_KEY)
  : null;

/** Mirrors Clerk auth state into the non-React lib/auth singleton so the
 * Zustand STT store can fetch a fresh JWT at transcribe time, and writes
 * the same state into useAuthStore so React components re-render. */
function ClerkTokenBridge() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();

  useEffect(() => {
    setTokenGetter(getToken as never);
  }, [getToken]);

  useEffect(() => {
    const email =
      user?.primaryEmailAddress?.emailAddress ??
      user?.emailAddresses?.[0]?.emailAddress ??
      null;
    setSignedInState(!!isSignedIn, email);
  }, [isSignedIn, user]);

  useEffect(() => {
    setAuthReady(!!isLoaded);
  }, [isLoaded]);

  return null;
}

/** When the build has no Clerk key, mark auth as "ready, never signed in"
 * once on mount so UI gates stop showing a loading state. */
function NoClerkBridge() {
  useEffect(() => {
    setAuthReady(true);
  }, []);
  return null;
}

/** Wraps ClerkProvider so Clerk's UI follows the active AnySpace theme:
 * dark themes apply Clerk's `dark` baseTheme, light themes use the default,
 * and `colorPrimary` always tracks the theme's accent. */
function ThemedClerkProvider({ children }: { children: React.ReactNode }) {
  const themeKind = useThemeStore((s) => s.resolved.kind);
  const accent = useThemeStore((s) => s.resolved.ui.accent);
  return (
    <ClerkProvider
      // Native-mode Clerk: the pre-built instance carries the client JWT in
      // an Authorization header (see clerkInstance.ts), and standardBrowser
      // false stops clerk-js depending on cross-site cookies that the Tauri
      // webview can't send. Without this, the session `touch` 401s into an
      // auto-logout a few seconds after sign-in.
      Clerk={clerkInstance!}
      publishableKey={PUBLISHABLE_KEY!}
      standardBrowser={false}
      afterSignOutUrl="/"
      appearance={{
        baseTheme: themeKind === "dark" ? dark : undefined,
        variables: { colorPrimary: accent },
      }}
    >
      {children}
    </ClerkProvider>
  );
}

const root = ReactDOM.createRoot(document.getElementById("root")!);

if (!PUBLISHABLE_KEY) {
  // No Clerk key configured — render without auth. The AnySpace Cloud STT
  // preset surfaces a clear "sign in required" toast at call time; every
  // other feature is unaffected.
  root.render(
    <React.StrictMode>
      <NoClerkBridge />
      <App />
    </React.StrictMode>,
  );
} else {
  root.render(
    <React.StrictMode>
      <ThemedClerkProvider>
        <ClerkTokenBridge />
        <App />
      </ThemedClerkProvider>
    </React.StrictMode>,
  );
}
