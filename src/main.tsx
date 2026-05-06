import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/globals.css";
import "./styles/layout.css";
import "./styles/clerk.css";
import "@xterm/xterm/css/xterm.css";
import { ClerkProvider, useAuth, useUser } from "@clerk/clerk-react";
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

/** Wraps ClerkProvider so the app's current theme accent flows into Clerk's
 * appearance variables. Surfaces are pinned to a light palette so modals and
 * the UserButton popover stay legible regardless of the host theme.
 *
 * `elements.*` overrides are required for the popover specifically: Clerk's
 * UserButton dropdown is the one surface that doesn't fully respect
 * `variables.colorBackground` and falls back to system color-scheme. */
function ThemedClerkProvider({ children }: { children: React.ReactNode }) {
  const accent = useThemeStore((s) => s.current.ui.accent);
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY!}
      afterSignOutUrl="/"
      appearance={{
        variables: {
          colorPrimary: accent,
          colorBackground: "#ffffff",
          colorText: "#0f172a",
          colorTextSecondary: "#475569",
          colorInputBackground: "#ffffff",
          colorInputText: "#0f172a",
        },
        elements: {
          rootBox: { colorScheme: "light" },
          card: { colorScheme: "light", backgroundColor: "#ffffff" },
          modalContent: { colorScheme: "light" },
          userButtonPopoverCard: {
            colorScheme: "light",
            backgroundColor: "#ffffff",
            color: "#0f172a",
            border: "1px solid #e2e8f0",
          },
          userButtonPopoverMain: { backgroundColor: "#ffffff" },
          userButtonPopoverFooter: { backgroundColor: "#f8fafc" },
          userButtonPopoverActionButton: { color: "#0f172a" },
          userButtonPopoverActionButtonText: { color: "#0f172a" },
          userButtonPopoverActionButtonIcon: { color: "#475569" },
          userButtonPopoverUserPreviewMainIdentifier: { color: "#0f172a" },
          userButtonPopoverUserPreviewSecondaryIdentifier: { color: "#475569" },
          userPreviewMainIdentifier: { color: "#0f172a" },
          userPreviewSecondaryIdentifier: { color: "#475569" },
        },
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
