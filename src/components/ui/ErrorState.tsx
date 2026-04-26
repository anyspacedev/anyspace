import type { ReactNode } from "react";
import { Icon } from "./Icon";

type Props = {
  title: string;
  message?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** Compact variant (no large icon, smaller padding) for narrow surfaces. */
  compact?: boolean;
};

export function ErrorState({ title, message, onRetry, retryLabel = "Retry", compact }: Props) {
  return (
    <div
      className={"error-state" + (compact ? " error-state-compact" : "")}
      role="alert"
    >
      <div className="error-state-icon">
        <Icon name="alert-circle" size={compact ? 16 : 22} />
      </div>
      <div className="error-state-body">
        <div className="error-state-title">{title}</div>
        {message && <div className="error-state-msg">{message}</div>}
      </div>
      {onRetry && (
        <button className="btn btn-ghost btn-sm btn-with-icon" onClick={onRetry}>
          <Icon name="refresh" size={12} />
          <span>{retryLabel}</span>
        </button>
      )}
    </div>
  );
}
