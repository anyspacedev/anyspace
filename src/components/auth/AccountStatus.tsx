import {
  SignInButton,
  SignedIn,
  SignedOut,
  UserButton,
} from "@clerk/clerk-react";
import { Icon } from "../ui/Icon";

const CLERK_CONFIGURED = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export function AccountStatus() {
  if (!CLERK_CONFIGURED) return null;
  return (
    <div className="account-status">
      <SignedOut>
        <SignInButton mode="modal">
          <button
            type="button"
            className="account-status-btn"
            aria-label="Sign in"
            title="Sign in"
          >
            <Icon name="user-round" size={16} />
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton afterSignOutUrl="/" />
      </SignedIn>
    </div>
  );
}
