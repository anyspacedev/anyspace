import { SignOutButton } from "@clerk/clerk-react";
import { useAuthStore } from "../../stores/authStore";
import { useDesktopSignIn } from "../../lib/clerkDesktopAuth";

/**
 * Inline account row shown in Settings sections that select the
 * AnySpace Cloud provider (STT, AI, Super Agent). Renders one of:
 *   - "this build wasn't compiled with a Clerk key" notice
 *   - "checking sign-in…" while the bridge initializes
 *   - signed-in row with email + sign-out
 *   - signed-out row with the desktop sign-in button (opens system browser)
 *
 * Reused across Settings panels and the Login Guide modal.
 */
export function AnySpaceCloudAccount() {
  const ready = useAuthStore((s) => s.ready);
  const signedIn = useAuthStore((s) => s.signedIn);
  const email = useAuthStore((s) => s.email);
  const clerkConfigured = useAuthStore((s) => s.clerkConfigured);

  if (!clerkConfigured) {
    return (
      <div className="stt-tc-account stt-tc-account-muted">
        This build wasn't compiled with a Clerk key — AnySpace Cloud is
        unavailable. Pick another provider.
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="stt-tc-account stt-tc-account-muted">
        Checking sign-in…
      </div>
    );
  }
  if (signedIn) {
    return (
      <div className="stt-tc-account">
        <span>
          Signed in as <strong>{email ?? "your account"}</strong>
        </span>
        <SignOutButton>
          <button type="button" className="btn btn-ghost">
            Sign out
          </button>
        </SignOutButton>
      </div>
    );
  }
  return (
    <div className="stt-tc-account">
      <span>Sign in to use AnySpace Cloud — no API key required.</span>
      <DesktopSignInPrimaryButton />
    </div>
  );
}

function DesktopSignInPrimaryButton() {
  const { isLoaded, busy, start } = useDesktopSignIn();
  return (
    <button
      type="button"
      className="btn btn-primary"
      disabled={!isLoaded || busy}
      onClick={() => void start()}
    >
      {busy ? "Opening browser…" : "Sign in"}
    </button>
  );
}
