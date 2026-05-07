import { useEffect, useState } from "react";
import { usePaneDragStore } from "../../stores/paneDragStore";
import { useUiHintsStore } from "../../stores/uiHintsStore";
import { Icon } from "../ui/Icon";

/**
 * Shown the first time a user drags a pane header. Explains the four-edge =
 * split, center = swap geometry. Auto-dismisses on next drag completion or
 * after 6s; either way the hint is marked seen so it never replays.
 */
export function DragCoachmark() {
  const dragging = usePaneDragStore((s) => s.sourcePaneId !== null);
  const seen = useUiHintsStore((s) => s.hints.seenPaneDragCoachmark);
  const mark = useUiHintsStore((s) => s.mark);
  const [show, setShow] = useState(false);

  // Open the coachmark when an actual drag begins for the first time.
  useEffect(() => {
    if (dragging && !seen) setShow(true);
  }, [dragging, seen]);

  // Once the drag ends, persist the hint and start a fade-out timer.
  useEffect(() => {
    if (!show) return;
    if (!dragging) {
      void mark("seenPaneDragCoachmark");
      const t = window.setTimeout(() => setShow(false), 1800);
      return () => window.clearTimeout(t);
    }
    // Hard cap: even mid-drag, dismiss after 6s so it doesn't get stuck open.
    const t = window.setTimeout(() => setShow(false), 6000);
    return () => window.clearTimeout(t);
  }, [show, dragging, mark]);

  if (!show) return null;

  return (
    <div className="drag-coachmark" role="status" aria-live="polite">
      <div className="drag-coachmark-card">
        <div className="drag-coachmark-title">
          <Icon name="square-dashed" size={14} />
          <span>Drop zones</span>
        </div>
        <div className="drag-coachmark-diagram" aria-hidden="true">
          <span className="dz-cell dz-top">top → split above</span>
          <span className="dz-cell dz-left">left → split L</span>
          <span className="dz-cell dz-center">center → swap</span>
          <span className="dz-cell dz-right">split R ← right</span>
          <span className="dz-cell dz-bottom">bottom → split below</span>
        </div>
      </div>
    </div>
  );
}
