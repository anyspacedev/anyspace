import type { CommandBlock } from "./osc133";

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
        const status =
          b.state === "finished"
            ? b.exitCode === 0
              ? "ok"
              : "fail"
            : b.state === "running"
            ? "running"
            : "pending";
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
              title={
                b.state === "finished"
                  ? `exit ${b.exitCode ?? "?"} • click to ${b.collapsed ? "expand" : "collapse"}`
                  : "running…"
              }
            />
          </div>
        );
      })}
    </div>
  );
}
