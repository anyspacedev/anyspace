import { useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import type { Pane, PaneKind } from "../../lib/types";

const KIND_LABELS: Record<PaneKind, string> = {
  terminal: "Terminal",
  editor: "Editor",
  preview: "Preview",
  filebrowser: "Files",
  empty: "Empty",
};

const KIND_ICONS: Record<PaneKind, string> = {
  terminal: "›_",
  editor: "✎",
  preview: "◉",
  filebrowser: "▣",
  empty: "·",
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
        <span className="pane-icon">{KIND_ICONS[pane.kind]}</span>
        <span className="pane-title">{title}</span>
        <span className="caret">▾</span>
      </button>
      {menuOpen && (
        <div className="pane-menu" onMouseLeave={() => setMenuOpen(false)}>
          {(Object.keys(KIND_LABELS) as PaneKind[]).filter((k) => k !== "empty").map((k) => (
            <button
              key={k}
              className={"pane-menu-item" + (k === pane.kind ? " active" : "")}
              onClick={() => {
                setPaneKind(tabId, pane.id, k, {});
                setMenuOpen(false);
              }}
            >
              <span className="pane-icon">{KIND_ICONS[k]}</span>
              <span>{KIND_LABELS[k]}</span>
            </button>
          ))}
        </div>
      )}
      <div className="pane-actions">
        <button
          className="icon-btn"
          title="Split horizontal (⌘D)"
          onClick={() => splitPane(tabId, pane.id, "horizontal")}
        >
          ⫶
        </button>
        <button
          className="icon-btn"
          title="Split vertical (⌘⇧D)"
          onClick={() => splitPane(tabId, pane.id, "vertical")}
        >
          ⫴
        </button>
        <button
          className="icon-btn"
          title="Close pane"
          onClick={() => closePane(tabId, pane.id)}
        >
          ×
        </button>
      </div>
    </div>
  );
}
