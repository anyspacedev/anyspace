import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent as RPointerEvent } from "react";
import {
  useScreenshotStore,
  type Screenshot,
  type ScreenshotNotice,
} from "../../stores/screenshotStore";
import {
  dispatchDropToPane,
  paneAcceptsDrop,
} from "../terminal/terminalRegistry";
import { Icon } from "../ui/Icon";

const NOTICE_TIMEOUT_MS = 6000;
// Movement (px) before pointerdown counts as a drag instead of a click. Same
// rough threshold used by HTML5 native drag; small enough that intentional
// drags feel responsive, large enough that accidental jitter on click is OK.
const DRAG_THRESHOLD_PX = 6;

// Floating column of screenshot thumbnails anchored to the lower-left of the
// window. New screenshots stack on top (column-reverse). Each thumb is a
// pointer-event-based drag source — drop it on a terminal pane to type the
// path at the prompt.
//
// Why pointer events and not native HTML5 drag: WKWebView and WebKitGTK
// swallow native `drop` events on pages that contain iframes (the preview
// pane). CLAUDE.md explicitly forbids `draggable`/`ondragstart` for in-app
// drags for this reason — the same constraint that drove pane-header
// drag-to-swap to a manual pointer pipeline.
//
// Accessibility:
//   - role="list" / role="listitem" so screen readers announce a group
//   - tabIndex on each thumb so keyboard users can reach + delete it
//   - aria-live region announces newly-captured screenshots with the path
//     so keyboard users (who can't drag) can reference the file manually
export function ScreenshotStack() {
  const items = useScreenshotStore((s) => s.items);
  const remove = useScreenshotStore((s) => s.remove);
  const notice = useScreenshotStore((s) => s.notice);
  const setNotice = useScreenshotStore((s) => s.setNotice);
  const [announcement, setAnnouncement] = useState("");
  const lastSeenIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (items.length === 0) {
      lastSeenIdRef.current = null;
      return;
    }
    const top = items[items.length - 1];
    if (top.id === lastSeenIdRef.current) return;
    lastSeenIdRef.current = top.id;
    const label = top.source === "preview" ? "Preview" : "Mobile";
    setAnnouncement(
      `${label} screenshot captured. Saved to ${top.path}. Drag onto a terminal to attach.`,
    );
  }, [items]);

  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), NOTICE_TIMEOUT_MS);
    return () => window.clearTimeout(id);
  }, [notice, setNotice]);

  if (items.length === 0 && !notice && !announcement) return null;

  return (
    <>
      <div
        className="screenshot-stack"
        role="list"
        aria-label="Captured screenshots"
      >
        {notice && <Notice notice={notice} onDismiss={() => setNotice(null)} />}
        {items.map((item, idx) => (
          <Thumb
            key={item.id}
            item={item}
            position={items.length - idx}
            total={items.length}
            onRemove={() => remove(item.id)}
          />
        ))}
      </div>
      <div className="screenshot-sr-status" role="status" aria-live="polite">
        {announcement}
      </div>
    </>
  );
}

function Notice({
  notice,
  onDismiss,
}: {
  notice: ScreenshotNotice;
  onDismiss: () => void;
}) {
  return (
    <div
      className={`screenshot-notice screenshot-notice-${notice.kind}`}
      role="alert"
    >
      <Icon name="alert-circle" size={14} />
      <span className="screenshot-notice-msg">{notice.message}</span>
      <button
        type="button"
        className="screenshot-notice-close"
        aria-label="Dismiss notice"
        onClick={onDismiss}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}

type DragSession = {
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  follower: HTMLImageElement | null;
  hoveredPane: HTMLElement | null;
};

function paneElementAt(x: number, y: number): HTMLElement | null {
  // Same hit-test pattern App.tsx uses for OS file drops — iterate panes
  // and check bounding rects directly. elementFromPoint can't be trusted
  // here because command-block overlays sit on top of terminals.
  for (const el of document.querySelectorAll<HTMLElement>("[data-pane-id]")) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) return el;
  }
  return null;
}

function Thumb({
  item,
  position,
  total,
  onRemove,
}: {
  item: Screenshot;
  position: number;
  total: number;
  onRemove: () => void;
}) {
  const sessionRef = useRef<DragSession | null>(null);
  const sourceLabel = item.source === "preview" ? "Preview" : "Mobile";
  const altText = `${sourceLabel} screenshot ${position} of ${total}`;

  const setHoveredPane = (next: HTMLElement | null) => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.hoveredPane === next) return;
    if (session.hoveredPane) {
      delete session.hoveredPane.dataset.screenshotDropover;
    }
    if (next) {
      next.dataset.screenshotDropover = "true";
    }
    session.hoveredPane = next;
  };

  const teardown = () => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.hoveredPane) {
      delete session.hoveredPane.dataset.screenshotDropover;
    }
    if (session.follower) {
      session.follower.remove();
    }
    document.body.classList.remove("screenshot-dragging");
    sessionRef.current = null;
  };

  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Clicks on the close button or its children should never start a drag.
    if ((e.target as HTMLElement).closest(".screenshot-thumb-close")) return;
    // Suppress text-selection and any browser-side drag gesture so we own
    // the interaction end-to-end.
    e.preventDefault();
    sessionRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      follower: null,
      hoveredPane: null,
    };
    // Pointer capture on the thumb keeps move/up flowing here even when
    // the cursor is over an iframe / different pane / outside the window.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: RPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;

    if (!session.active) {
      const dx = e.clientX - session.startX;
      const dy = e.clientY - session.startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      // Cross threshold → start the drag.
      session.active = true;
      const follower = document.createElement("img");
      follower.src = item.dataUrl;
      follower.alt = "";
      follower.className = "screenshot-drag-follower";
      follower.style.left = `${e.clientX}px`;
      follower.style.top = `${e.clientY}px`;
      document.body.appendChild(follower);
      document.body.classList.add("screenshot-dragging");
      session.follower = follower;
    }

    if (session.follower) {
      session.follower.style.left = `${e.clientX}px`;
      session.follower.style.top = `${e.clientY}px`;
    }

    const pane = paneElementAt(e.clientX, e.clientY);
    const paneId = pane?.dataset.paneId;
    setHoveredPane(paneId && paneAcceptsDrop(paneId) ? pane : null);
  };

  const onPointerUp = (e: RPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    const wasActive = session.active;
    const finalPane = session.hoveredPane;
    teardown();
    if (!wasActive) return;
    const paneId = finalPane?.dataset.paneId;
    if (!paneId) return;
    dispatchDropToPane(paneId, [item.path]);
  };

  const onPointerCancel = (e: RPointerEvent<HTMLDivElement>) => {
    const session = sessionRef.current;
    if (!session || session.pointerId !== e.pointerId) return;
    teardown();
  };

  // Keyboard: Delete/Backspace removes a focused thumb. Drag-drop itself
  // is mouse-only; the path is in the aria-live announcement so a keyboard
  // user can copy it from the screen-reader output.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onRemove();
    }
  };

  return (
    <div
      className="screenshot-thumb"
      role="listitem"
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
      aria-label={`${altText}. Drag onto a terminal to attach. Press Delete to remove.`}
      title={`${sourceLabel} screenshot — drag onto a terminal`}
    >
      <img className="screenshot-thumb-img" src={item.dataUrl} alt={altText} draggable={false} />
      <button
        type="button"
        className="screenshot-thumb-close"
        aria-label={`Remove ${sourceLabel.toLowerCase()} screenshot`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
