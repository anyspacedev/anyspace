import { useEffect, useMemo, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { FixedSizeList, type ListChildComponentProps } from "react-window";
import {
  mobileLogsStart,
  mobileLogsStop,
  type MobileLogLine,
} from "../../lib/mobile";
import { Icon } from "../ui/Icon";

// Virtualized logcat panel. Buffers up to BUFFER_CAP lines (oldest dropped),
// flushes to React state on a 100ms tick so we don't re-render per-line at
// scroll-rate. Filter is substring; level filter is nice-to-have for v2.

const BUFFER_CAP = 10_000;
const ROW_HEIGHT = 18;
const FLUSH_MS = 100;

export function LogStrip({ connectionId }: { connectionId: string }) {
  const [lines, setLines] = useState<MobileLogLine[]>([]);
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  const linesRef = useRef<MobileLogLine[]>([]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<FixedSizeList | null>(null);

  // Track the listing area's pixel size — react-window needs concrete dims.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Subscribe to log lines for this connection.
  useEffect(() => {
    let aborted = false;
    let flushTimer: number | null = null;
    let started = false;

    const channel = new Channel<MobileLogLine>();
    channel.onmessage = (line) => {
      if (aborted) return;
      linesRef.current.push(line);
      if (linesRef.current.length > BUFFER_CAP) {
        linesRef.current.splice(0, linesRef.current.length - BUFFER_CAP);
      }
      if (flushTimer == null) {
        flushTimer = window.setTimeout(() => {
          flushTimer = null;
          setLines([...linesRef.current]);
        }, FLUSH_MS);
      }
    };

    (async () => {
      try {
        await mobileLogsStart(connectionId, channel);
        if (aborted) {
          await mobileLogsStop(connectionId).catch(() => {});
          return;
        }
        started = true;
      } catch (e) {
        if (!aborted) setError(String(e));
      }
    })();

    return () => {
      aborted = true;
      if (flushTimer != null) clearTimeout(flushTimer);
      if (started) void mobileLogsStop(connectionId).catch(() => {});
    };
  }, [connectionId]);

  const filtered = useMemo(() => {
    if (!filter) return lines;
    const f = filter.toLowerCase();
    return lines.filter(
      (l) => l.message.toLowerCase().includes(f) || l.tag.toLowerCase().includes(f),
    );
  }, [lines, filter]);

  // Auto-scroll on new lines if user hasn't disabled it.
  useEffect(() => {
    if (autoScroll && listRef.current && filtered.length > 0) {
      listRef.current.scrollToItem(filtered.length - 1, "end");
    }
  }, [filtered.length, autoScroll]);

  const Row = ({ index, style }: ListChildComponentProps) => {
    const line = filtered[index];
    if (!line) return null;
    const lev = line.level.toLowerCase();
    return (
      <div className={"log-row level-" + lev} style={style}>
        <span className="log-ts">{line.ts}</span>
        <span className={"log-level lev-" + lev}>{line.level}</span>
        <span className="log-tag">{line.tag}</span>
        <span className="log-msg">{line.message}</span>
      </div>
    );
  };

  return (
    <div className="log-strip">
      <div className="log-strip-toolbar">
        <input
          className="log-strip-filter"
          placeholder="Filter (substring)"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          spellCheck={false}
        />
        <span className="log-strip-count">
          {filter ? `${filtered.length} / ${lines.length}` : `${lines.length}`}
        </span>
        <label className="log-strip-autoscroll" title="Stick to newest line">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          <span>Auto-scroll</span>
        </label>
        <button
          className="icon-btn"
          title="Clear buffer"
          aria-label="Clear logs"
          onClick={() => {
            linesRef.current = [];
            setLines([]);
          }}
        >
          <Icon name="x" size={12} />
        </button>
      </div>
      <div ref={containerRef} className="log-strip-list">
        {error ? (
          <div className="log-strip-error">{error}</div>
        ) : size.h > 0 && filtered.length > 0 ? (
          <FixedSizeList
            ref={listRef}
            height={size.h}
            width={size.w}
            itemCount={filtered.length}
            itemSize={ROW_HEIGHT}
            overscanCount={20}
          >
            {Row}
          </FixedSizeList>
        ) : (
          <div className="log-strip-empty">
            {lines.length === 0 ? "Waiting for log lines…" : "No matching lines"}
          </div>
        )}
      </div>
    </div>
  );
}
