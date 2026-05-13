import { useEffect, useMemo, useState } from "react";
import {
  describeProposal,
  isWriteSensitive,
  useBackgroundProposalsStore,
  type Proposal,
} from "../../stores/backgroundProposalsStore";

const KIND_LABEL: Record<Proposal["kind"], string> = {
  "kanban.move": "Move task",
  "kanban.update": "Update task",
  "pty.write": "Type in terminal",
  "team.broadcast": "Send to team",
  "team.send_to_pane": "Send to team agent",
  "pane.close": "Close pane",
  note: "Note",
};

const CONFIDENCE_ARIA: Record<NonNullable<Proposal["confidence"]>, string> = {
  high: "high confidence",
  medium: "medium confidence",
  low: "low confidence",
};

/**
 * Sticky proposals list rendered at the top of the SA panel when the active
 * session is the background watcher. Pending rows surface Apply / Dismiss;
 * applied rows fade and stay for session-scoped history.
 */
export function BackgroundProposalsBlock() {
  const proposals = useBackgroundProposalsStore((s) => s.proposals);
  const apply = useBackgroundProposalsStore((s) => s.apply);
  const dismiss = useBackgroundProposalsStore((s) => s.dismiss);
  const clearApplied = useBackgroundProposalsStore((s) => s.clearApplied);

  const pending = useMemo(
    () => proposals.filter((p) => p.status === "pending" || p.status === "applying"),
    [proposals],
  );
  const applied = useMemo(
    () => proposals.filter((p) => p.status === "applied").slice(0, 8),
    [proposals],
  );

  const [collapsed, setCollapsed] = useState(false);
  // Auto-expand on new arrivals.
  useEffect(() => {
    if (pending.length > 0) setCollapsed(false);
  }, [pending.length]);

  const grouped = pending.length > 5;
  const groups = useMemo(() => {
    if (!grouped) return null;
    const m = new Map<Proposal["kind"], Proposal[]>();
    for (const p of pending) {
      const list = m.get(p.kind) ?? [];
      list.push(p);
      m.set(p.kind, list);
    }
    return Array.from(m.entries());
  }, [grouped, pending]);

  return (
    <section
      className="sa-proposals"
      role="region"
      aria-live="polite"
      aria-label="Pending background-agent proposals"
    >
      <button
        type="button"
        className="sa-proposals-header"
        onClick={() => setCollapsed((c) => !c)}
        aria-expanded={!collapsed}
      >
        <span className="sa-proposals-chevron" aria-hidden="true">
          {collapsed ? "▸" : "▾"}
        </span>
        <span className="sa-proposals-title">
          Pending proposals · {pending.length}
        </span>
        {applied.length > 0 && (
          <span
            className="sa-proposals-applied-count"
            aria-label={`${applied.length} recently applied`}
          >
            ✓ {applied.length}
          </span>
        )}
      </button>

      {!collapsed && pending.length === 0 && (
        <div className="sa-proposals-empty">
          Background watcher is on. Nothing to surface right now.
        </div>
      )}

      {!collapsed && pending.length > 0 && (
        <div className="sa-proposals-list">
          {grouped && groups
            ? groups.map(([kind, items]) => (
                <div key={kind} className="sa-proposals-group">
                  <div className="sa-proposals-group-head">
                    {KIND_LABEL[kind]} · {items.length}
                  </div>
                  {items.map((p) => (
                    <ProposalRow
                      key={p.id}
                      proposal={p}
                      onApply={() => void apply(p.id)}
                      onDismiss={() => dismiss(p.id)}
                    />
                  ))}
                </div>
              ))
            : pending.map((p) => (
                <ProposalRow
                  key={p.id}
                  proposal={p}
                  onApply={() => void apply(p.id)}
                  onDismiss={() => dismiss(p.id)}
                />
              ))}
        </div>
      )}

      {!collapsed && applied.length > 0 && (
        <div className="sa-proposals-applied">
          {applied.map((p) => (
            <div key={p.id} className="sa-proposal-row applied">
              <div className="sa-proposal-body">
                <div className="sa-proposal-title">{describeProposal(p)}</div>
                <div className="sa-proposal-reason">Applied · {p.reason}</div>
              </div>
            </div>
          ))}
          <button
            type="button"
            className="sa-proposals-clear"
            onClick={clearApplied}
            aria-label="Clear applied proposals"
          >
            Clear applied
          </button>
        </div>
      )}
    </section>
  );
}

function ProposalRow(props: {
  proposal: Proposal;
  onApply: () => void;
  onDismiss: () => void;
}) {
  const { proposal: p, onApply, onDismiss } = props;
  const [expanded, setExpanded] = useState(false);
  const applying = p.status === "applying";
  const sensitive = isWriteSensitive(p.kind);
  const isNote = p.kind === "note";
  const title = isNote ? "" : describeProposal(p);
  const noteText = isNote ? String(p.args.text ?? p.reason) : "";

  return (
    <div
      className={
        "sa-proposal-row" +
        (sensitive ? " sensitive" : "") +
        (expanded ? " expanded" : "")
      }
    >
      <div
        className="sa-proposal-body"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded((v) => !v);
          }
        }}
      >
        {!isNote && (
          <span
            className={"sa-proposal-confidence " + (p.confidence ?? "medium")}
            aria-label={CONFIDENCE_ARIA[p.confidence ?? "medium"]}
            title={CONFIDENCE_ARIA[p.confidence ?? "medium"]}
          />
        )}
        <div className="sa-proposal-text">
          {isNote ? (
            <div className="sa-proposal-note">{noteText}</div>
          ) : (
            <>
              <div className="sa-proposal-title">{title}</div>
              <div className={"sa-proposal-reason" + (expanded ? " full" : "")}>
                {p.reason}
              </div>
              {p.kind === "pane.close" && (
                <div className="sa-proposal-warn">
                  This will close the pane permanently. Output cannot be recovered.
                </div>
              )}
              {p.applyError && (
                <div className="sa-proposal-error" role="alert">
                  {p.applyError}
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {!isNote && (
        <div className="sa-proposal-actions">
          <button
            type="button"
            className="btn btn-ghost sa-proposal-dismiss"
            onClick={onDismiss}
            disabled={applying}
            aria-label="Dismiss proposal"
          >
            Dismiss
          </button>
          <button
            type="button"
            className={"btn btn-primary sa-proposal-apply" + (sensitive ? " sensitive" : "")}
            onClick={onApply}
            disabled={applying}
            aria-label={
              applying
                ? "Applying"
                : p.applyError
                  ? "Retry apply"
                  : p.kind === "pty.write"
                    ? "Send to terminal"
                    : "Apply proposal"
            }
          >
            {applying ? "…" : p.applyError ? "Retry" : p.kind === "pty.write" ? "Send" : "Apply"}
          </button>
        </div>
      )}
      {isNote && (
        <div className="sa-proposal-actions">
          <button
            type="button"
            className="btn btn-ghost sa-proposal-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss note"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
