import { useEffect, useId } from "react";
import { SignInButton } from "@clerk/clerk-react";
import { Icon } from "../ui/Icon";
import { useAuthStore } from "../../stores/authStore";
import {
  useLoginGuideStore,
  type LoginGuideFeature,
} from "../../stores/loginGuideStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useHideBrowsersWhile } from "../../lib/useHideBrowsersWhile";

const COPY: Record<
  LoginGuideFeature,
  { title: string; subtitle: string; settingsHint: string }
> = {
  "ai-explain": {
    title: "Sign in to use Explain",
    subtitle:
      "Explain runs on AnySpace Cloud — no API key required when you're signed in.",
    settingsHint: "Settings → AI",
  },
  "super-agent": {
    title: "Sign in to use Super Agent",
    subtitle:
      "Super Agent runs on AnySpace Cloud — no API key required when you're signed in.",
    settingsHint: "Settings → Super Agent",
  },
};

export function LoginGuideModal() {
  const open = useLoginGuideStore((s) => s.open);
  const feature = useLoginGuideStore((s) => s.feature);
  const close = useLoginGuideStore((s) => s.close);
  const signedIn = useAuthStore((s) => s.signedIn);
  const clerkConfigured = useAuthStore((s) => s.clerkConfigured);
  const setView = useWorkspaceStore((s) => s.setView);
  const titleId = useId();
  useHideBrowsersWhile(open);

  // Auto-close once Clerk reports a successful sign-in.
  useEffect(() => {
    if (open && signedIn) close();
  }, [open, signedIn, close]);

  // Esc-to-close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open || !feature) return null;
  const copy = COPY[feature];

  const goToSettings = () => {
    setView("settings");
    close();
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal login-guide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close modal-close-floating"
          onClick={close}
          aria-label="Close"
        >
          <Icon name="x" size={14} />
        </button>
        <h2 id={titleId} className="modal-title">
          {copy.title}
        </h2>
        <p className="login-guide-sub">{copy.subtitle}</p>

        {!clerkConfigured ? (
          <div className="login-guide-warn">
            This build wasn't compiled with a Clerk key — AnySpace Cloud is
            unavailable. Switch to your own provider in {copy.settingsHint}.
          </div>
        ) : (
          <div className="login-guide-actions">
            <SignInButton mode="modal">
              <button type="button" className="btn btn-primary">
                Sign in
              </button>
            </SignInButton>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={goToSettings}
            >
              Use my own API key — {copy.settingsHint}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
