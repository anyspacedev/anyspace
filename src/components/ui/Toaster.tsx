import { useToastStore, type Toast } from "../../stores/toastStore";
import { Icon, type IconName } from "./Icon";

const KIND_ICON: Record<Toast["kind"], IconName> = {
  info: "alert-circle",
  success: "check",
  warn: "alert-circle",
  error: "alert-circle",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="toaster" role="region" aria-label="Notifications">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}`}
          role={t.kind === "error" ? "alert" : "status"}
          aria-live={t.kind === "error" ? "assertive" : "polite"}
        >
          <span className="toast-icon" aria-hidden="true">
            <Icon name={KIND_ICON[t.kind]} size={14} />
          </span>
          <div className="toast-text">
            <div className="toast-title">{t.title}</div>
            {t.body && <div className="toast-body">{t.body}</div>}
          </div>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
