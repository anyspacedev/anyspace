import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useOperatorInboxStore } from "../../stores/operatorInboxStore";
import { ModeStrip } from "./ModeStrip";
import { InboxPopover } from "../inbox/InboxPopover";
import { BackgroundProposalsPill } from "../ui/BackgroundProposalsPill";
import { UpdaterPill } from "./UpdaterPill";

export function StatusBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const paneCount = tab ? Object.keys(tab.panes).length : 0;
  const inboxCount = useOperatorInboxStore((s) => s.pings.length);
  const [inboxOpen, setInboxOpen] = useState(false);
  // Pull the live app version from Tauri instead of hard-coding it — the
  // hardcoded `0.1.0` was already stale (we're at 0.1.1 in prod) and would
  // mislead users looking at the updater pill next to it.
  const [appVersion, setAppVersion] = useState("");
  useEffect(() => {
    let cancelled = false;
    void getVersion().then((v) => { if (!cancelled) setAppVersion(v); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="statusbar">
      <div className="status-left">
        <ModeStrip />
        <span>AnySpace {appVersion || "…"}</span>
        <span className="status-divider" />
        <span>{tabs.length} tab{tabs.length === 1 ? "" : "s"}</span>
        <span className="status-divider" />
        <span>{paneCount} pane{paneCount === 1 ? "" : "s"}</span>
        {inboxCount > 0 && (
          <>
            <span className="status-divider" />
            <span className="status-inbox-wrap">
              <button
                type="button"
                className="status-inbox-badge"
                title={`${inboxCount} unread @operator message${inboxCount === 1 ? "" : "s"} — click for actions`}
                aria-haspopup="dialog"
                aria-expanded={inboxOpen}
                onClick={() => setInboxOpen((v) => !v)}
              >
                <span className="status-inbox-dot" />
                {inboxCount} @operator
              </button>
              {inboxOpen && <InboxPopover onClose={() => setInboxOpen(false)} />}
            </span>
          </>
        )}
        <BackgroundProposalsPill />
        <UpdaterPill />
      </div>
    </div>
  );
}
