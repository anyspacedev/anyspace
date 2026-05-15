import { useState } from "react";

import { downloadAndApply } from "../../lib/updater";
import { useUpdaterStore } from "../../stores/updaterStore";

/**
 * Status-bar affordance for the auto-updater. Renders nothing while there's
 * no update; flips to a clickable pill the moment `checkForUpdate()` reports
 * an available release.
 *
 * Layout mirrors `.status-inbox-badge` so spacing/colors track theme changes
 * without new CSS work.
 */
export function UpdaterPill() {
  const state = useUpdaterStore((s) => s.state);
  const setState = useUpdaterStore((s) => s.set);
  const [open, setOpen] = useState(false);

  // Only render once there's something for the user to act on. Idle / checking
  // / one-shot errors stay out of the status bar (they surface in Settings).
  if (
    state.phase !== "available"
    && state.phase !== "downloading"
    && state.phase !== "ready"
  ) {
    return null;
  }

  const label =
    state.phase === "downloading"
      ? `Downloading ${pct(state.downloaded, state.total)}%`
      : state.phase === "ready"
        ? "Update ready — relaunch"
        : `Update ${state.version} available`;

  const onInstall = () => {
    setOpen(false);
    void downloadAndApply(setState);
  };

  return (
    <>
      <span className="status-divider" />
      <span className="status-inbox-wrap">
        <button
          type="button"
          className="status-inbox-badge"
          title={
            state.phase === "available"
              ? `AnySpace ${state.version} is available. Click for details.`
              : state.phase === "downloading"
                ? "Downloading update…"
                : "Update applied — restart to use the new version."
          }
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          <span className="status-inbox-dot" />
          {label}
        </button>
        {open && state.phase === "available" && (
          <div className="inbox-popover" role="dialog" aria-label="Update available">
            <div className="inbox-popover-head">
              <span className="inbox-popover-title">
                AnySpace {state.version}
                {state.pubDate && (
                  <span style={{ opacity: 0.6, marginLeft: 6, fontWeight: 400 }}>
                    {formatDate(state.pubDate)}
                  </span>
                )}
              </span>
            </div>
            {state.notes && (
              <pre style={{
                margin: "8px 12px 0",
                padding: 0,
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                lineHeight: 1.5,
                whiteSpace: "pre-wrap",
                color: "var(--fg-muted)",
                maxHeight: 220,
                overflowY: "auto",
              }}>{trimNotes(state.notes)}</pre>
            )}
            <div style={{
              display: "flex", justifyContent: "flex-end", gap: 6,
              padding: "10px 12px 12px",
            }}>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setOpen(false)}
              >
                Not now
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onInstall}
              >
                Install + Restart
              </button>
            </div>
          </div>
        )}
      </span>
    </>
  );
}

function pct(downloaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((downloaded / total) * 100));
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  });
}

function trimNotes(notes: string): string {
  // Release bodies on GitHub can be huge. Show the first ~600 chars; users
  // can click through to the GH release for the full diff.
  if (notes.length <= 600) return notes;
  return notes.slice(0, 600).trimEnd() + "…";
}
