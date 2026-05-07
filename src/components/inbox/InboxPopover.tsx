import { useEffect, useRef } from "react";
import { useOperatorInboxStore, type OperatorPing } from "../../stores/operatorInboxStore";
import { handoffInboxToSuperAgent } from "../../lib/operatorInboxHandoff";
import { Icon } from "../ui/Icon";

function pingTitle(p: OperatorPing): string {
  const tag = p.type === "escalation" ? "[ESCALATION] " : "";
  return `${tag}${p.from} → ${p.to}`;
}

function pingBodyPreview(body: string): string {
  const first = body.split("\n").find((l) => l.trim().length > 0) ?? body;
  return first.length > 120 ? first.slice(0, 117) + "…" : first;
}

/**
 * Click-to-open popover for the @operator badge. Replaces the old Alt+click
 * dismiss magic with explicit per-row Hand-off / Dismiss controls plus a
 * "Hand off all" CTA at the bottom.
 */
export function InboxPopover({ onClose }: { onClose: () => void }) {
  const pings = useOperatorInboxStore((s) => s.pings);
  const markAllRead = useOperatorInboxStore((s) => s.markAllRead);
  const markRead = useOperatorInboxStore((s) => s.markRead);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [onClose]);

  // If pings get drained externally (handoff fired), close ourselves.
  useEffect(() => {
    if (pings.length === 0) onClose();
  }, [pings.length, onClose]);

  return (
    <div className="inbox-popover" ref={ref} role="dialog" aria-label="Operator inbox">
      <div className="inbox-popover-head">
        <span className="inbox-popover-title">
          {pings.length} unread {pings.length === 1 ? "message" : "messages"}
        </span>
        <button
          type="button"
          className="inbox-popover-clear"
          onClick={() => {
            markAllRead();
            onClose();
          }}
          title="Mark all as read without handing off"
        >
          Dismiss all
        </button>
      </div>
      <div className="inbox-popover-list">
        {pings.map((p) => (
          <div
            key={p.msgId}
            className={
              "inbox-popover-row" +
              (p.type === "escalation" ? " inbox-popover-row--escalation" : "")
            }
          >
            <div className="inbox-popover-row-text">
              <div className="inbox-popover-row-head">
                <span className="inbox-popover-row-title">{pingTitle(p)}</span>
                <span className="inbox-popover-row-team">{p.teamName}</span>
              </div>
              <div className="inbox-popover-row-body">{pingBodyPreview(p.body)}</div>
            </div>
            <button
              type="button"
              className="icon-btn"
              aria-label="Dismiss this message"
              title="Dismiss"
              onClick={() => markRead(p.msgId)}
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
      <div className="inbox-popover-foot">
        <button
          type="button"
          className="btn btn-primary btn-with-icon"
          onClick={() => {
            void handoffInboxToSuperAgent().catch((err) =>
              console.warn("[inbox] handoff failed", err),
            );
            onClose();
          }}
        >
          <Icon name="sparkles" size={12} />
          <span>Hand off all to Super Agent</span>
        </button>
      </div>
    </div>
  );
}
