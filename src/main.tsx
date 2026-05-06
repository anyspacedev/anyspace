import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/layout.css";
import "./styles/clerk.css";
import "@xterm/xterm/css/xterm.css";
import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-react";
import { dark } from "@clerk/themes";
import { setSignedInState, setTokenGetter } from "./lib/auth";
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

/** Mirrors Clerk auth state into the non-React lib/auth singleton so the
 * Zustand STT store can fetch a fresh JWT at transcribe time. */
function ClerkTokenBridge() {
  const { isSignedIn, getToken } = useAuth();
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

  return null;
}

/** Wraps ClerkProvider so Clerk's UI follows the active Teamship theme:
 * dark themes apply Clerk's `dark` baseTheme, light themes use the default,
 * and `colorPrimary` always tracks the theme's accent. */
function ThemedClerkProvider({ children }: { children: React.ReactNode }) {
  const themeKind = useThemeStore((s) => s.current.kind);
  const accent = useThemeStore((s) => s.current.ui.accent);
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY!}
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
  // No Clerk key configured — render without auth. The Teamship Cloud STT
  // preset surfaces a clear "sign in required" toast at call time; every
  // other feature is unaffected.
  root.render(
    <React.StrictMode>
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
