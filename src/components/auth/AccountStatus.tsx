import { SignedIn, SignedOut, UserButton } from "@clerk/clerk-react";
import { Icon } from "../ui/Icon";
import { useDesktopSignIn } from "../../lib/clerkDesktopAuth";

const CLERK_CONFIGURED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function AccountStatus() {
  if (!CLERK_CONFIGURED) return null;
  return (
    <div className="account-status">
      <SignedOut>
        <DesktopSignInIconButton />
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </div>
  );
}

function DesktopSignInIconButton() {
  const { isLoaded, busy, start } = useDesktopSignIn();
  return (
    <button
      type="button"
      className="account-status-btn"
      aria-label="Sign in"
      title={busy ? "Opening browser…" : "Sign in"}
      disabled={!isLoaded || busy}
      onClick={() => void start()}
    >
      <Icon name="user-round" size={16} />
    </button>
  );
}
