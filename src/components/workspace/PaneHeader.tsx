import { useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Pane, PaneKind } from "../../lib/types";
import { Icon, type IconName } from "../ui/Icon";

const KIND_LABELS: Record<PaneKind, string> = {
  terminal: "Terminal",
  editor: "Editor",
  preview: "Preview",
  filebrowser: "Files",
  empty: "Empty",
};

const KIND_ICONS: Record<PaneKind, IconName> = {
  terminal: "terminal",
  editor: "file-edit",
  preview: "globe",
  filebrowser: "folder-tree",
  empty: "square-dashed",
};

export function PaneHeader({ pane, tabId }: { pane: Pane; tabId: string }) {
  const setPaneKind = useWorkspaceStore((s) => s.setPaneKind);
  const splitPane = useWorkspaceStore((s) => s.splitPane);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const [menuOpen, setMenuOpen] = useState(false);

  const title =
    (pane.payload?.title as string) ||
    (pane.payload?.path as string) ||
    KIND_LABELS[pane.kind];

  return (
    <div className="pane-header">
      <button
        className="pane-kind-btn"
        onClick={() => setMenuOpen((o) => !o)}
        title="Change pane type"
      >
        <span className="pane-icon">
          <Icon name={KIND_ICONS[pane.kind]} size={14} />
        </span>
        <span className="pane-title">{title}</span>
        <span className="caret">
          <Icon name="chevron-down" size={12} />
        </span>
      </button>
      {menuOpen && (
        <div className="pane-menu" onMouseLeave={() => setMenuOpen(false)}>
          {(Object.keys(KIND_LABELS) as PaneKind[])
            .filter((k) => k !== "empty")
            .map((k) => (
              <button
                key={k}
                className={"pane-menu-item" + (k === pane.kind ? " active" : "")}
                onClick={() => {
                  setPaneKind(tabId, pane.id, k, {});
                  setMenuOpen(false);
                }}
              >
                <span className="pane-icon">
                  <Icon name={KIND_ICONS[k]} size={14} />
                </span>
                <span>{KIND_LABELS[k]}</span>
              </button>
            ))}
        </div>
      )}
      <div className="pane-actions">
        <button
          className="icon-btn"
          title="Split horizontal (⌘D)"
          aria-label="Split horizontal"
          onClick={() => splitPane(tabId, pane.id, "horizontal")}
        >
          <Icon name="split-vertical" size={14} />
        </button>
        <button
          className="icon-btn"
          title="Split vertical (⌘⇧D)"
          aria-label="Split vertical"
          onClick={() => splitPane(tabId, pane.id, "vertical")}
        >
          <Icon name="split-horizontal" size={14} />
        </button>
        <button
          className="icon-btn"
          title="Close pane"
          aria-label="Close pane"
          onClick={() => closePane(tabId, pane.id)}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  );
}
