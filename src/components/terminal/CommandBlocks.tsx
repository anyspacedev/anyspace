import type { CommandBlock } from "./osc133";
import { Icon, type IconName } from "../ui/Icon";

type Status = "ok" | "fail" | "running" | "pending";

const STATUS_ICON: Record<Status, IconName> = {
  running: "play",
  ok: "check",
  fail: "alert-circle",
  pending: "dot",
};

export function CommandBlocks({
  blocks,
  rowHeight,
  scrollTop,
  containerHeight,
  onToggle,
}: {
  blocks: CommandBlock[];
  rowHeight: number;
  scrollTop: number;
  containerHeight: number;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="cmd-blocks-overlay" style={{ pointerEvents: "none" }}>
      {blocks.map((b) => {
        // absolute pixel y (relative to first row in scrollback).
        const top = b.startRow * rowHeight - scrollTop;
        // height: from start to end (or to bottom).
        const lastRow = b.endRow ?? b.startRow + 1;
        const height = Math.max(rowHeight, (lastRow - b.startRow) * rowHeight);
        if (top + height < 0 || top > containerHeight) return null;
        const status: Status =
          b.state === "finished"
            ? b.exitCode === 0
              ? "ok"
              : "fail"
            : b.state === "running"
            ? "running"
            : "pending";
        const tabIcon: IconName = b.collapsed ? "chevron-right" : STATUS_ICON[status];
        const label =
          b.state === "finished"
            ? `${status === "ok" ? "Succeeded" : "Failed"} (exit ${b.exitCode ?? "?"}). ${b.collapsed ? "Expand" : "Collapse"}.`
            : b.state === "running"
            ? "Running. Click to collapse."
            : "Pending.";
        return (
          <div
            key={b.id}
            className={"cmd-block " + status + (b.collapsed ? " collapsed" : "")}
            style={{
              transform: `translateY(${Math.max(0, top)}px)`,
              height: `${height}px`,
              pointerEvents: "auto",
            }}
          >
            <button
              className="cmd-block-tab"
              onClick={() => onToggle(b.id)}
              aria-label={label}
              title={
                b.state === "finished"
                  ? `exit ${b.exitCode ?? "?"} • click to ${b.collapsed ? "expand" : "collapse"}`
                  : "running…"
              }
            >
              <Icon name={tabIcon} size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
