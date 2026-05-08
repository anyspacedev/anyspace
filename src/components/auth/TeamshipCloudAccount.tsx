import { SignInButton, SignOutButton } from "@clerk/clerk-react";
import { useAuthStore } from "../../stores/authStore";

/**
 * Inline account row shown in Settings sections that select the
 * Teamship Cloud provider (STT, AI, Super Agent). Renders one of:
 *   - "this build wasn't compiled with a Clerk key" notice
 *   - "checking sign-in…" while the bridge initializes
 *   - signed-in row with email + sign-out
 *   - signed-out row with the Clerk sign-in modal trigger
 *
 * Reused across Settings panels and the Login Guide modal.
 */
export function TeamshipCloudAccount() {
  const ready = useAuthStore((s) => s.ready);
  const signedIn = useAuthStore((s) => s.signedIn);
  const email = useAuthStore((s) => s.email);
  const clerkConfigured = useAuthStore((s) => s.clerkConfigured);

  if (!clerkConfigured) {
    return (
      <div className="stt-tc-account stt-tc-account-muted">
        This build wasn't compiled with a Clerk key — Teamship Cloud is
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
      <span>Sign in to use Teamship Cloud — no API key required.</span>
      <SignInButton mode="modal">
        <button type="button" className="btn btn-primary">
          Sign in
        </button>
      </SignInButton>
    </div>
  );
}
