import { useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent, KeyboardEvent } from "react";
import {
  useScreenshotStore,
  type Screenshot,
  type ScreenshotNotice,
} from "../../stores/screenshotStore";
import { setDraggingPath } from "../../lib/screenshotDrag";
import { Icon } from "../ui/Icon";

const NOTICE_TIMEOUT_MS = 6000;

// Floating column of screenshot thumbnails anchored to the lower-left of the
// window. New screenshots stack on top (column-reverse). Each thumb is an
// HTML5 drag source — drop it on a terminal pane to type the path at the
// prompt.
//
// Accessibility:
//   - role="list" / role="listitem" so screen readers announce a group
//   - tabIndex on each thumb so keyboard users can reach + delete it
//   - aria-live region announces newly-captured screenshots
//   - Drag-drop is mouse-only by nature; the announcement explains the
//     attached file path so a keyboard user can copy it from the
//     screen-reader output and reference it manually.
export function ScreenshotStack() {
  const items = useScreenshotStore((s) => s.items);
  const remove = useScreenshotStore((s) => s.remove);
  const notice = useScreenshotStore((s) => s.notice);
  const setNotice = useScreenshotStore((s) => s.setNotice);
  const [announcement, setAnnouncement] = useState("");
  const lastSeenIdRef = useRef<string | null>(null);

  // Watch for new arrivals so we can announce + speak the file path. Only
  // fires when the topmost item changes, so deletions and reorders don't
  // re-announce.
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

  // Auto-dismiss the visible notice after 6s — long enough to read the
  // permission-denied path, short enough that a stale message doesn't linger.
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
  const altText = useMemo(() => {
    return `${sourceLabel} screenshot ${position} of ${total}`;
  }, [sourceLabel, position, total]);

  const onDragStart = (e: DragEvent<HTMLDivElement>) => {
    // Two channels: HTML5 dataTransfer is the primary path; the module-level
    // ref is a fallback if a future WebView regression swallows native drop
    // events on iframe-bearing pages (CLAUDE.md flags this for pane headers).
    if (e.dataTransfer) {
      e.dataTransfer.setData("text/plain", item.path);
      e.dataTransfer.setData("text/uri-list", `file://${item.path}`);
      e.dataTransfer.effectAllowed = "copy";
    }
    setDraggingPath(item.path);
  };
  const onDragEnd = () => setDraggingPath(null);

  // Keyboard: Delete/Backspace removes the thumb from the stack so keyboard
  // users aren't stuck with a screenshot they don't want. (Drag-drop itself
  // remains mouse-only — see the aria-live announcement which gives keyboard
  // users the file path to reference manually.)
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
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      aria-label={`${altText}. Drag onto a terminal to attach. Press Delete to remove.`}
      title={`${sourceLabel} screenshot — drag onto a terminal`}
    >
      <img className="screenshot-thumb-img" src={item.dataUrl} alt={altText} />
      <button
        type="button"
        className="screenshot-thumb-close"
        aria-label={`Remove ${sourceLabel.toLowerCase()} screenshot`}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        // Don't let the close button initiate a drag on the parent.
        onMouseDown={(e) => e.stopPropagation()}
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  );
}
