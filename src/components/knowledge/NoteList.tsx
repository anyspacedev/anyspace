import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import type { NoteSummary } from "../../lib/knowledge";

function formatAgo(ms: number): string {
  if (!ms) return "—";
  const diff = Math.max(0, Date.now() - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return new Date(ms).toLocaleDateString();
}

type Props = {
  notes: NoteSummary[];
  activeSlug: string | null;
  loading: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  onSelect: (slug: string) => void;
  onNew: () => void;
};

export function NoteList({
  notes,
  activeSlug,
  loading,
  query,
  onQueryChange,
  onSelect,
  onNew,
}: Props) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [focusedIdx, setFocusedIdx] = useState(-1);

  // Reset focus when the result set changes.
  useEffect(() => {
    setFocusedIdx(-1);
  }, [query]);

  // Scroll the active row into view when the parent changes selection.
  useEffect(() => {
    if (!activeSlug) return;
    const el = scrollRef.current?.querySelector<HTMLDivElement>(
      `[data-slug="${CSS.escape(activeSlug)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [activeSlug]);

  function onKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => Math.min(notes.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const target = notes[focusedIdx];
      if (target) {
        e.preventDefault();
        onSelect(target.slug);
      }
    }
  }

  return (
    <aside className="kn-list" aria-label="Notes">
      <div className="kn-list-header">
        <div className="kn-input-wrap" style={{ width: "100%" }}>
          <Icon name="search" size={14} />
          <input
            ref={searchRef}
            type="search"
            className="kn-input kn-list-search"
            value={query}
            placeholder="Search notes…"
            onChange={(e) => onQueryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                onQueryChange("");
                (e.target as HTMLInputElement).blur();
              }
            }}
            aria-label="Search notes"
          />
        </div>
        <button
          type="button"
          className="kn-list-new"
          onClick={onNew}
          aria-label="Create new note"
        >
          <Icon name="plus" size={12} />
          <span>New note</span>
        </button>
      </div>

      <div
        ref={scrollRef}
        className="kn-list-scroll"
        role="listbox"
        tabIndex={0}
        onKeyDown={onKey}
        aria-activedescendant={
          focusedIdx >= 0 ? `kn-note-${notes[focusedIdx]?.slug}` : undefined
        }
      >
        {loading ? (
          <div className="kn-list-skel" aria-hidden>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i}>
                <div className="b" />
                <div className="b short" />
                <div className="b short" />
              </div>
            ))}
          </div>
        ) : notes.length === 0 ? (
          <div className="kn-list-empty">
            {query.trim() ? "No notes match." : "No notes yet."}
          </div>
        ) : (
          notes.map((n, i) => (
            <div
              key={n.slug}
              id={`kn-note-${n.slug}`}
              data-slug={n.slug}
              className={
                "kn-list-item" +
                (n.slug === activeSlug ? " active" : "") +
                (i === focusedIdx ? " focused" : "")
              }
              role="option"
              aria-selected={n.slug === activeSlug}
              onClick={() => onSelect(n.slug)}
              onMouseEnter={() => setFocusedIdx(i)}
            >
              <div className="kn-li-title" title={n.title}>
                {n.title}
              </div>
              <div className="kn-li-meta">
                {formatAgo(n.updated)}
                {n.backlinkCount > 0 ? ` · ${n.backlinkCount} backlink${n.backlinkCount === 1 ? "" : "s"}` : ""}
              </div>
              {n.preview && (
                <div className="kn-li-preview" title={n.preview}>
                  {n.preview}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
