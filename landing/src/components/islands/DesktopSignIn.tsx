/**
 * Bridge island for the desktop OAuth handoff.
 *
 * The AnySpace desktop app's WebView OAuth modal can't complete Google
 * sign-in (WebKit ITP refuses to persist Clerk's session cookie on the
 * cross-site XHR that seeds OAuth state). The desktop app routes the
 * user here via the system browser; we let Clerk's hosted SignIn
 * component handle OAuth in a real browser context, then mint a 60s
 * single-use sign-in ticket via api.anyspace.dev and redirect to the
 * desktop's loopback listener.
 *
 * Trust boundary: `return_to` is attacker-controllable (it's a query
 * param). We validate it before opening Clerk so this page can't be
 * abused as an open redirect — only http(s)-free loopback hosts on a
 * sane port pointing at `/callback` are accepted.
 */

import { useEffect, useMemo, useState } from "react";
import {
  ClerkProvider,
  SignIn,
  useAuth,
} from "@clerk/clerk-react";

type Props = {
  publishableKey: string;
  apiBase: string;
};

type ParsedQuery =
  | { kind: "ok"; returnTo: string; nonce: string; provider: string | null }
  | { kind: "error"; message: string };

function parseAndValidate(): ParsedQuery {
  if (typeof window === "undefined") {
    return { kind: "error", message: "client-only page" };
  }
  const q = new URLSearchParams(window.location.search);
  const returnTo = q.get("return_to") ?? "";
  const nonce = q.get("nonce") ?? "";
  const provider = q.get("provider");
  if (!returnTo) return { kind: "error", message: "missing return_to" };
  if (!nonce) return { kind: "error", message: "missing nonce" };

  let url: URL;
  try {
    url = new URL(returnTo);
  } catch {
    return { kind: "error", message: "return_to is not a valid URL" };
  }
  if (url.protocol !== "http:") {
    return {
      kind: "error",
      message: "return_to must use http:// (loopback only)",
    };
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return {
      kind: "error",
      message: "return_to host must be 127.0.0.1 or localhost",
    };
  }
  if (url.pathname !== "/callback") {
    return { kind: "error", message: "return_to path must be /callback" };
  }
  const portNum = Number(url.port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return { kind: "error", message: "return_to must include a valid port" };
  }
  return { kind: "ok", returnTo, nonce, provider };
}

export default function DesktopSignIn({ publishableKey, apiBase }: Props) {
  // Memo so the validation runs exactly once even if React re-renders.
  const parsed = useMemo(parseAndValidate, []);

  if (parsed.kind === "error") {
    return <ErrorView title="Invalid sign-in link" message={parsed.message} />;
  }
  if (!publishableKey) {
    return (
      <ErrorView
        title="Sign-in unavailable"
        message="This site is missing PUBLIC_CLERK_PUBLISHABLE_KEY. Contact support."
      />
    );
  }
  if (!apiBase) {
    return (
      <ErrorView
        title="Sign-in unavailable"
        message="This site is missing PUBLIC_ANYSPACE_API_URL. Contact support."
      />
    );
  }

  return (
    <ClerkProvider publishableKey={publishableKey}>
      <Inner returnTo={parsed.returnTo} nonce={parsed.nonce} apiBase={apiBase} />
    </ClerkProvider>
  );
}

type InnerProps = { returnTo: string; nonce: string; apiBase: string };
type Phase = "sign-in" | "minting" | "redirecting" | "error";

function Inner({ returnTo, nonce, apiBase }: InnerProps) {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [phase, setPhase] = useState<Phase>("sign-in");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    // Only fire once per mount — phase guards re-entry if Clerk re-renders.
    if (phase !== "sign-in") return;
    setPhase("minting");
    (async () => {
      try {
        const token = await getToken();
        if (!token) {
          throw new Error("Clerk did not return a session token");
        }
        const resp = await fetch(
          `${apiBase.replace(/\/$/, "")}/v1/desktop-bridge/mint-ticket`,
          {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        if (!resp.ok) {
          const body = await resp.text().catch(() => "");
          throw new Error(
            `mint-ticket failed (${resp.status}): ${body.slice(0, 200) || "no body"}`,
          );
        }
        const data = (await resp.json()) as { ticket?: unknown };
        if (typeof data.ticket !== "string" || !data.ticket) {
          throw new Error("mint-ticket response missing 'ticket'");
        }
        setPhase("redirecting");
        const url =
          `${returnTo}?ticket=${encodeURIComponent(data.ticket)}` +
          `&nonce=${encodeURIComponent(nonce)}`;
        window.location.href = url;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setPhase("error");
      }
    })();
  }, [isLoaded, isSignedIn, phase, getToken, returnTo, nonce, apiBase]);

  if (!isLoaded) return <Pending label="Loading sign-in…" />;
  if (phase === "minting") return <Pending label="Preparing your desktop session…" />;
  if (phase === "redirecting") return <Pending label="Returning to AnySpace…" />;
  if (phase === "error") {
    return (
      <ErrorView
        title="Couldn't complete sign-in"
        message={error ?? "Unknown error"}
        retry={() => {
          setError(null);
          setPhase("sign-in");
        }}
      />
    );
  }

  // phase === "sign-in" && !isSignedIn — render Clerk's UI.
  return (
    <div className="mx-auto max-w-md py-12">
      <div className="mb-6 text-center">
        <h1 className="text-display font-semibold text-fg">
          Sign in to AnySpace
        </h1>
        <p className="mt-2 text-sm text-fg-muted">
          This browser tab completes sign-in for the desktop app. You'll be
          redirected back automatically.
        </p>
      </div>
      <SignIn routing="virtual" />
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-24 text-center">
      <div
        className="h-6 w-6 animate-spin rounded-full border-2 border-fg-muted border-t-transparent"
        aria-hidden="true"
      />
      <p className="text-sm text-fg-muted">{label}</p>
    </div>
  );
}

function ErrorView({
  title,
  message,
  retry,
}: {
  title: string;
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="mx-auto max-w-md py-16">
      <div className="rounded-lg border border-border bg-bg-elev/40 p-6">
        <h1 className="text-headline font-semibold text-fg">{title}</h1>
        <p className="mt-3 text-sm text-fg-muted">{message}</p>
        {retry ? (
          <button
            type="button"
            onClick={retry}
            className="mt-5 rounded-md border border-border-strong px-4 py-2 text-sm text-fg hover:bg-bg-elev"
          >
            Try again
          </button>
        ) : (
          <p className="mt-4 text-xs text-fg-dim">
            Close this tab and re-launch sign-in from the desktop app.
          </p>
        )}
      </div>
    </div>
  );
}
