import { useState } from "react";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePaneDragStore, type DropZone } from "../../stores/paneDragStore";
import type { Pane, PaneKind } from "../../lib/types";
import { Icon, type IconName } from "../ui/Icon";
import { runSuperBrain } from "../../lib/superBrain";

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

const DRAG_THRESHOLD = 4;

function detectDropZone(rect: DOMRect, clientX: number, clientY: number): DropZone {
  const x = (clientX - rect.left) / rect.width;
  const y = (clientY - rect.top) / rect.height;
  const EDGE = 0.25;
  const dl = x;
  const dr = 1 - x;
  const dt = y;
  const db = 1 - y;
  const minD = Math.min(dl, dr, dt, db);
  if (minD > EDGE) return "swap";
  if (minD === dl) return "left";
  if (minD === dr) return "right";
  if (minD === dt) return "top";
  return "bottom";
}

type HeaderProps = {
  pane: Pane;
  tabId: string;
  // 1-based index of this pane in selectedPaneIds, or null when not selected.
  selectionIndex?: number | null;
  // Broadcast group size when this pane is the active driver; 0 means hide pill.
  broadcastSize?: number;
};

export function PaneHeader({ pane, tabId, selectionIndex, broadcastSize = 0 }: HeaderProps) {
  const setPaneKind = useWorkspaceStore((s) => s.setPaneKind);
  const splitPane = useWorkspaceStore((s) => s.splitPane);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const [menuOpen, setMenuOpen] = useState(false);

  const title =
    (pane.payload?.title as string) ||
    (pane.payload?.path as string) ||
    KIND_LABELS[pane.kind];

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't initiate a drag from interactive children (kind menu, action buttons).
    if ((e.target as HTMLElement).closest("button")) return;

    const elem = e.currentTarget;
    const pointerId = e.pointerId;
    // Capture so pointer events keep firing on this element even when the
    // cursor moves over child elements that absorb input (xterm canvas,
    // Monaco editor, preview iframe). Without capture, pointermove would
    // disappear into the iframe and we'd never see the release.
    try {
      elem.setPointerCapture(pointerId);
    } catch {
      // capture can fail if pointer was already released; safe to ignore
    }

    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD) return;
        started = true;
        usePaneDragStore.getState().start(pane.id, tabId);
        document.body.classList.add("is-dragging-pane");
      }
      const el = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
      const targetEl = el?.closest("[data-pane-id]") as HTMLElement | null;
      if (!targetEl) {
        usePaneDragStore.getState().setTarget(null, null);
        return;
      }
      const targetId = targetEl.getAttribute("data-pane-id");
      if (!targetId || targetId === pane.id) {
        usePaneDragStore.getState().setTarget(null, null);
        return;
      }
      const zone = detectDropZone(targetEl.getBoundingClientRect(), ev.clientX, ev.clientY);
      usePaneDragStore.getState().setTarget(targetId, zone);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      elem.removeEventListener("pointermove", onMove);
      elem.removeEventListener("pointerup", onUp);
      elem.removeEventListener("pointercancel", onUp);
      if (elem.hasPointerCapture(pointerId)) elem.releasePointerCapture(pointerId);
      document.body.classList.remove("is-dragging-pane");
      if (!started) {
        usePaneDragStore.getState().end();
        return;
      }
      const { targetPaneId, zone } = usePaneDragStore.getState();
      usePaneDragStore.getState().end();
      if (!targetPaneId || targetPaneId === pane.id || !zone) return;
      const ws = useWorkspaceStore.getState();
      if (zone === "swap") {
        ws.swapPanes(tabId, pane.id, targetPaneId);
      } else {
        ws.movePaneToEdge(tabId, pane.id, targetPaneId, zone);
      }
    };

    elem.addEventListener("pointermove", onMove);
    elem.addEventListener("pointerup", onUp);
    elem.addEventListener("pointercancel", onUp);
  };

  return (
    <div className="pane-header" onPointerDown={onPointerDown}>
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
      {selectionIndex != null && (
        <span
          className="pane-broadcast-badge"
          title={`Broadcast member #${selectionIndex}`}
          aria-label={`Broadcast member ${selectionIndex}`}
        >
          {selectionIndex}
        </span>
      )}
      {broadcastSize >= 2 && (
        <span
          className="pane-broadcast-pill"
          title="Keystrokes mirror to every selected pane. Press Esc to stop."
        >
          → {broadcastSize} panes
        </span>
      )}
      <div className="pane-actions">
        {pane.kind === "terminal" && (
          <button
            className="icon-btn"
            title="Super Brain — AI suggests next command (⌘⇧B)"
            aria-label="Super Brain"
            onClick={() => void runSuperBrain(tabId)}
          >
            <Icon name="sparkles" size={14} />
          </button>
        )}
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
