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

function paneElementAt(x: number, y: number): HTMLElement | null {
  // Same hit-test pattern App.tsx uses for OS file drops — iterate panes
  // and check bounding rects directly. elementFromPoint can't be trusted
  // here because command-block overlays sit on top of terminals (and an
  // iframe under the cursor would return the iframe element itself).
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
  const sourceLabel = item.source === "preview" ? "Preview" : "Mobile";
  const altText = `${sourceLabel} screenshot ${position} of ${total}`;

  // Native pointer-event drag — mirrors PaneHeader.tsx's drag-to-swap
  // pattern. We attach pointermove/pointerup directly on the captured
  // element instead of going through React synthetic events: with
  // setPointerCapture + iframes in the page, React's synthetic delegation
  // does not reliably deliver subsequent move/up events to the source.
  const onPointerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Clicks on the close button or its children should never start a drag.
    if ((e.target as HTMLElement).closest(".screenshot-thumb-close")) return;
    e.preventDefault();

    const elem = e.currentTarget;
    const pointerId = e.pointerId;
    const startX = e.clientX;
    const startY = e.clientY;

    try {
      elem.setPointerCapture(pointerId);
    } catch {
      /* capture can fail if pointer already released */
    }

    let started = false;
    let follower: HTMLImageElement | null = null;
    let hoveredPane: HTMLElement | null = null;

    const setHoveredPane = (next: HTMLElement | null) => {
      if (hoveredPane === next) return;
      if (hoveredPane) delete hoveredPane.dataset.screenshotDropover;
      if (next) next.dataset.screenshotDropover = "true";
      hoveredPane = next;
    };

    const teardown = () => {
      elem.removeEventListener("pointermove", onMove);
      elem.removeEventListener("pointerup", onUp);
      elem.removeEventListener("pointercancel", onUp);
      if (elem.hasPointerCapture(pointerId)) {
        elem.releasePointerCapture(pointerId);
      }
      if (hoveredPane) {
        delete hoveredPane.dataset.screenshotDropover;
        hoveredPane = null;
      }
      if (follower) {
        follower.remove();
        follower = null;
      }
      document.body.classList.remove("screenshot-dragging");
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) {
          return;
        }
        started = true;
        follower = document.createElement("img");
        follower.src = item.dataUrl;
        follower.alt = "";
        follower.className = "screenshot-drag-follower";
        follower.style.left = `${ev.clientX}px`;
        follower.style.top = `${ev.clientY}px`;
        document.body.appendChild(follower);
        document.body.classList.add("screenshot-dragging");
      }
      if (follower) {
        follower.style.left = `${ev.clientX}px`;
        follower.style.top = `${ev.clientY}px`;
      }
      const pane = paneElementAt(ev.clientX, ev.clientY);
      const paneId = pane?.dataset.paneId;
      setHoveredPane(paneId && paneAcceptsDrop(paneId) ? pane : null);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const wasStarted = started;
      const finalPane = hoveredPane;
      teardown();
      if (!wasStarted || !finalPane) return;
      const paneId = finalPane.dataset.paneId;
      if (!paneId) return;
      dispatchDropToPane(paneId, [item.path]);
    };

    elem.addEventListener("pointermove", onMove);
    elem.addEventListener("pointerup", onUp);
    elem.addEventListener("pointercancel", onUp);
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
