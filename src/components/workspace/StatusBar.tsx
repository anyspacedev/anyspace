import { useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useOperatorInboxStore } from "../../stores/operatorInboxStore";
import { ModeStrip } from "./ModeStrip";
import { InboxPopover } from "../inbox/InboxPopover";
import { BackgroundProposalsPill } from "../ui/BackgroundProposalsPill";

export function StatusBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const tab = tabs.find((t) => t.id === activeTabId);
  const paneCount = tab ? Object.keys(tab.panes).length : 0;
  const inboxCount = useOperatorInboxStore((s) => s.pings.length);
  const [inboxOpen, setInboxOpen] = useState(false);

  return (
    <div className="statusbar">
      <div className="status-left">
        <ModeStrip />
        <span>AnySpace 0.1.0</span>
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
      </div>
    </div>
  );
}
