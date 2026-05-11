import { useState } from "react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useSshHostsStore } from "../../stores/sshHostsStore";
import { formatHostTarget } from "../../lib/sshCommand";
import { usePaneDragStore, type DropZone } from "../../stores/paneDragStore";
import type { Pane, PaneKind } from "../../lib/types";
import { Icon, type IconName } from "../ui/Icon";
import { runSuperBrain, toastSuperBrainResult } from "../../lib/superBrain";

const KIND_LABELS: Record<PaneKind, string> = {
  terminal: "Terminal",
  editor: "Editor",
  preview: "Preview",
  filebrowser: "Files",
  mobile: "Mobile",
  browser: "Browser",
  empty: "Empty",
};

const KIND_ICONS: Record<PaneKind, IconName> = {
  terminal: "terminal",
  editor: "file-edit",
  preview: "globe",
  filebrowser: "folder-tree",
  mobile: "smartphone",
  browser: "globe",
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
  const sshHostId = pane.payload?.sshHostId as string | undefined;
  const sshHost = useSshHostsStore((s) =>
    sshHostId ? s.hosts.find((h) => h.id === sshHostId) ?? null : null,
  );
  const [menuOpen, setMenuOpen] = useState(false);

  const title = sshHost
    ? sshHost.name
    : (pane.payload?.title as string) ||
      (pane.payload?.path as string) ||
      KIND_LABELS[pane.kind];
  const subtitle = sshHost ? formatHostTarget(sshHost) : null;

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
        title={subtitle ? `${title} — ${subtitle}` : "Change pane type"}
      >
        <span className="pane-icon">
          <Icon name={sshHost ? "server" : KIND_ICONS[pane.kind]} size={14} />
        </span>
        <span className="pane-title">{title}</span>
        {sshHost && <span className="pane-ssh-badge" aria-label="SSH session">SSH</span>}
        {subtitle && <span className="pane-subtitle">{subtitle}</span>}
        <span className="caret">
          <Icon name="chevron-down" size={12} />
        </span>
      </button>
      {menuOpen && (
        <div className="pane-menu" onMouseLeave={() => setMenuOpen(false)}>
          <div className="pane-menu-section">Change pane kind</div>
          {(Object.keys(KIND_LABELS) as PaneKind[])
            // "browser" excluded until the embedded WebView path works on
            // Linux; the kind stays in the union so persisted panes render.
            .filter((k) => k !== "empty" && k !== "browser")
            .map((k) => (
              <button
                key={k}
                className={"pane-menu-item" + (k === pane.kind ? " active" : "")}
                disabled={k === pane.kind}
                onClick={async () => {
                  if (k === pane.kind) return;
                  // Terminal panes own a live PTY and command-block history;
                  // switching away ends the session. Confirm so a misclick
                  // doesn't destroy work the user wanted to keep.
                  const hasState =
                    pane.kind === "terminal" &&
                    Boolean(pane.payload?.sessionId);
                  if (hasState) {
                    const ok = await confirmDialog(
                      `Replace this Terminal pane with ${KIND_LABELS[k]}? The PTY session and scrollback will be discarded.`,
                      { title: "Replace pane", kind: "warning" },
                    );
                    if (!ok) {
                      setMenuOpen(false);
                      return;
                    }
                  }
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
        {pane.kind === "terminal" && !sshHostId && (
          <button
            className="icon-btn"
            title="Super Brain — AI suggests next command (⌘⇧B)"
            aria-label="Super Brain"
            onClick={() => void runSuperBrain(tabId).then(toastSuperBrainResult)}
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
