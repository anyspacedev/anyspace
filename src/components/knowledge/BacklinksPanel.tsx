import { Icon } from "../ui/Icon";
import type { Note } from "../../lib/knowledge";

type Props = {
  note: Note | null;
  collapsed: boolean;
  onToggle: () => void;
  onOpen: (slug: string) => void;
  onCreate: (title: string) => void;
};

export function BacklinksPanel({
  note,
  collapsed,
  onToggle,
  onOpen,
  onCreate,
}: Props) {
  if (collapsed) {
    return (
      <aside className="kn-rail collapsed" aria-label="Backlinks panel">
        <button
          type="button"
          className="kn-rail-toggle"
          onClick={onToggle}
          title="Show backlinks panel (⌘B)"
          aria-label="Expand backlinks panel"
        >
          <Icon name="chevron-left" size={14} />
        </button>
      </aside>
    );
  }

  const backlinks = note?.backlinks ?? [];
  const outbound = note?.outbound ?? [];

  return (
    <aside className="kn-rail" aria-label="Backlinks panel">
      <button
        type="button"
        className="kn-rail-toggle"
        onClick={onToggle}
        title="Hide backlinks panel (⌘B)"
        aria-label="Collapse backlinks panel"
      >
        <Icon name="chevron-right" size={14} />
        <span>References</span>
      </button>

      <section className="kn-rail-section" aria-label="Backlinks">
        <h4>
          <span>Backlinks</span>
          <span className="count">{backlinks.length}</span>
        </h4>
        {backlinks.length === 0 ? (
          <div className="kn-rail-empty">
            {note
              ? "No notes link here yet."
              : "Select a note to see references."}
          </div>
        ) : (
          backlinks.map((b) => (
            <div
              key={b.sourceSlug}
              className="kn-rail-row"
              onClick={() => onOpen(b.sourceSlug)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter") onOpen(b.sourceSlug);
              }}
            >
              <div className="kn-rail-title">{b.sourceTitle}</div>
              {b.context && <div className="kn-rail-ctx">{b.context}</div>}
            </div>
          ))
        )}
      </section>

      <section className="kn-rail-section" aria-label="Outbound links">
        <h4>
          <span>Outbound</span>
          <span className="count">{outbound.length}</span>
        </h4>
        {outbound.length === 0 ? (
          <div className="kn-rail-empty">
            Use <code>[[Note Title]]</code> to link.
          </div>
        ) : (
          outbound.map((o, i) => (
            <div
              key={`${o.targetTitle}-${i}`}
              className={"kn-rail-row" + (o.resolved ? "" : " unresolved")}
            >
              <div
                className="kn-rail-title"
                onClick={() => {
                  if (o.resolved && o.targetSlug) onOpen(o.targetSlug);
                  else onCreate(o.targetTitle);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  if (o.resolved && o.targetSlug) onOpen(o.targetSlug);
                  else onCreate(o.targetTitle);
                }}
              >
                {o.targetTitle}
                {!o.resolved && (
                  <button
                    type="button"
                    className="kn-rail-create"
                    style={{ marginLeft: 6 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onCreate(o.targetTitle);
                    }}
                  >
                    Create
                  </button>
                )}
              </div>
              {o.context && <div className="kn-rail-ctx">{o.context}</div>}
            </div>
          ))
        )}
      </section>
    </aside>
  );
}
