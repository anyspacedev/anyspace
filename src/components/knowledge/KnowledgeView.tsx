import { useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../ui/Icon";
import { useKnowledgeStore } from "../../stores/knowledgeStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  knowledgeRead,
  knowledgeWrite,
  slugify,
  type Note,
} from "../../lib/knowledge";
import { NoteList } from "./NoteList";
import { NoteEditor } from "./NoteEditor";
import { BacklinksPanel } from "./BacklinksPanel";
import { GraphView } from "./GraphView";

type ViewMode = "editor" | "graph";

export function KnowledgeView() {
  const projectPath = useKnowledgeStore((s) => s.activeProjectPath);
  const notes = useKnowledgeStore((s) => s.notes);
  const setProject = useKnowledgeStore((s) => s.setProject);
  const reload = useKnowledgeStore((s) => s.reload);
  const graph = useKnowledgeStore((s) => s.graph);
  const activeSlug = useKnowledgeStore((s) => s.activeSlug);
  const setActiveSlug = useKnowledgeStore((s) => s.setActiveSlug);
  const backlinksPanelOpen = useKnowledgeStore((s) => s.backlinksPanelOpen);
  const toggleBacklinksPanel = useKnowledgeStore((s) => s.toggleBacklinksPanel);
  const activeTabProject = useWorkspaceStore((s) => {
    const t = s.tabs.find((tab) => tab.id === s.activeTabId);
    return t?.projectPath ?? null;
  });

  const [view, setView] = useState<ViewMode>("editor");
  const [query, setQuery] = useState("");
  const [isDraft, setIsDraft] = useState(false);
  const [activeNote, setActiveNote] = useState<Note | null>(null);
  const [noteLoading, setNoteLoading] = useState(false);

  // Filter notes by query client-side (cheap up to thousands).
  const visibleNotes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return notes;
    return notes.filter(
      (n) =>
        n.title.toLowerCase().includes(q) ||
        n.preview.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }, [notes, query]);

  // Fetch the active note whenever the slug changes.
  useEffect(() => {
    if (!projectPath) return;
    if (!activeSlug) {
      setActiveNote(null);
      return;
    }
    let cancelled = false;
    setNoteLoading(true);
    void knowledgeRead(projectPath, activeSlug)
      .then((n) => {
        if (!cancelled) {
          setActiveNote(n);
          setIsDraft(false);
        }
      })
      .catch((e) => {
        console.warn("[knowledge] read failed", activeSlug, e);
        if (!cancelled) setActiveNote(null);
      })
      .finally(() => {
        if (!cancelled) setNoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, activeSlug]);

  // Auto-select the first note when the list loads if none is active.
  useEffect(() => {
    if (!projectPath) return;
    if (activeSlug) return;
    if (isDraft) return;
    if (notes.length > 0) setActiveSlug(notes[0].slug);
  }, [projectPath, notes, activeSlug, isDraft, setActiveSlug]);

  async function pickFolder() {
    try {
      const result = await openDialog({
        directory: true,
        multiple: false,
        title: "Pick a project folder for knowledge",
      });
      if (typeof result === "string") {
        await setProject(result);
      }
    } catch (e) {
      console.warn("[knowledge] folder pick failed", e);
    }
  }

  // ----- Empty state (no project) -----
  if (!projectPath) {
    return (
      <div className="kn-root">
        <div className="kn-empty">
          <div className="kn-empty-card">
            <span className="kn-empty-icon">
              <Icon name="network" size={64} />
            </span>
            <h2>Project knowledge</h2>
            <p>
              Your notes live next to your code, in{" "}
              <code>.anyspace/knowledge/</code>. Pick a project to start.
            </p>
            <button
              type="button"
              className="kn-empty-primary"
              onClick={pickFolder}
            >
              <Icon name="folder" size={14} />
              <span>Pick project folder</span>
            </button>
            {activeTabProject && (
              <button
                type="button"
                className="kn-list-new"
                style={{ width: "auto", padding: "0 14px" }}
                onClick={() => void setProject(activeTabProject)}
              >
                Use active workspace: {shortPath(activeTabProject)}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ----- Save handler passed to NoteEditor -----
  async function handleSave(args: {
    title: string;
    body: string;
    tags: string[];
    slug?: string;
  }): Promise<{ slug: string }> {
    if (!projectPath) throw new Error("no active project");
    const written = await knowledgeWrite({
      projectPath,
      title: args.title,
      body: args.body,
      tags: args.tags,
      slug: args.slug,
    });
    // If this was a draft (no slug yet) → set active so subsequent reads work.
    if (!args.slug || args.slug !== written.slug) {
      setActiveSlug(written.slug);
      setIsDraft(false);
    }
    setActiveNote(written);
    // The watcher reloads the list automatically; trigger an immediate refresh
    // too so the UI doesn't wait on the 200ms debounce after first save.
    void reload();
    return { slug: written.slug };
  }

  function handleNew() {
    setIsDraft(true);
    setActiveSlug(null);
    setActiveNote(null);
  }

  function handleSelect(slug: string) {
    setIsDraft(false);
    setActiveSlug(slug);
    setView("editor");
  }

  function handleWikilinkOpen(refstr: string) {
    // Resolve client-side using the same rules as the Rust side.
    const lower = refstr.toLowerCase();
    const byTitle = notes.find((n) => n.title.toLowerCase() === lower);
    if (byTitle) {
      handleSelect(byTitle.slug);
      return;
    }
    const bySlug = notes.find((n) => n.slug === refstr || n.slug === slugify(refstr));
    if (bySlug) {
      handleSelect(bySlug.slug);
      return;
    }
    // Unresolved → create a new note with that title.
    void handleSave({ title: refstr, body: "", tags: [] }).catch((e) => {
      console.warn("[knowledge] auto-create failed", refstr, e);
    });
  }

  function handleCreate(title: string) {
    void handleSave({ title, body: "", tags: [] }).catch((e) => {
      console.warn("[knowledge] create failed", title, e);
    });
  }

  return (
    <div className="kn-root">
      <div className="kn-topbar">
        <div className="kn-topbar-left">
          <button
            type="button"
            className="kn-project-pill"
            onClick={pickFolder}
            title={projectPath}
            aria-label="Change project folder"
          >
            <Icon name="folder" size={14} />
            <span className="kn-project-name">{shortPath(projectPath)}</span>
            <Icon name="chevron-down" size={12} />
          </button>
        </div>

        <div className="kn-seg" role="tablist" aria-label="Knowledge view mode">
          <button
            type="button"
            role="tab"
            aria-selected={view === "editor"}
            className={view === "editor" ? "active" : ""}
            onClick={() => setView("editor")}
            title="Editor (⌘\\)"
          >
            Editor
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === "graph"}
            className={view === "graph" ? "active" : ""}
            onClick={() => setView("graph")}
            title="Graph (⌘\\)"
          >
            Graph
          </button>
        </div>

        <div className="kn-topbar-right">
          <div className="kn-input-wrap">
            <Icon name="search" size={14} />
            <input
              type="search"
              className="kn-input"
              value={query}
              placeholder="Search notes…"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search notes"
            />
          </div>
          <button
            type="button"
            className="kn-icon-button primary"
            onClick={handleNew}
            title="New note (⌘N)"
            aria-label="Create new note"
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>

      <div className={"kn-body" + (backlinksPanelOpen ? "" : " no-backlinks")}>
        <NoteList
          notes={visibleNotes}
          activeSlug={activeSlug}
          loading={false}
          query={query}
          onQueryChange={setQuery}
          onSelect={handleSelect}
          onNew={handleNew}
        />

        <div className="kn-center">
          {view === "editor" ? (
            noteLoading ? (
              <div className="kn-list-skel" aria-hidden style={{ padding: 24 }}>
                <div className="b" />
                <div className="b short" />
                <div className="b" />
                <div className="b" />
                <div className="b short" />
              </div>
            ) : (
              <NoteEditor
                key={isDraft ? "__draft__" : activeSlug ?? "__none__"}
                note={activeNote}
                allNotes={notes}
                isDraft={isDraft}
                onSave={handleSave}
                onWikilinkOpen={handleWikilinkOpen}
                initialFocusTitle={isDraft}
              />
            )
          ) : (
            <GraphView graph={graph} activeSlug={activeSlug} onOpen={handleSelect} />
          )}
        </div>

        <BacklinksPanel
          note={activeNote}
          collapsed={!backlinksPanelOpen}
          onToggle={() => void toggleBacklinksPanel()}
          onOpen={handleSelect}
          onCreate={handleCreate}
        />
      </div>
    </div>
  );
}

function shortPath(p: string): string {
  // Truncate to last two segments for the pill.
  const parts = p.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return "…/" + parts.slice(-2).join("/");
}
