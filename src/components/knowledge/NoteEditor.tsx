import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import { useThemeStore } from "../../stores/themeStore";
import { monacoThemeFor } from "../../themes/apply";
import { registerEditor, unregisterEditor } from "../stt/editorRegistry";
import type { Note, NoteSummary } from "../../lib/knowledge";
import { slugify } from "../../lib/knowledge";

type SaveStatus = "idle" | "saving" | "saved" | "dirty" | "error";

type Props = {
  note: Note | null;
  /** Notes list used for the `[[` completion provider. */
  allNotes: NoteSummary[];
  /** True while no note is open yet — show a placeholder draft. */
  isDraft: boolean;
  /** Called with the latest title/body/tags. Parent debounces actual writes. */
  onSave: (args: { title: string; body: string; tags: string[]; slug?: string }) => Promise<{ slug: string } | void>;
  onWikilinkOpen: (refstr: string) => void;
  /** Compute initial slug for a draft (helps the title-input set focus on mount). */
  initialFocusTitle?: boolean;
};

const WIKILINK_RE = /\[\[([^\]\n]+)\]\]/g;

export function NoteEditor({
  note,
  allNotes,
  isDraft,
  onSave,
  onWikilinkOpen,
  initialFocusTitle,
}: Props) {
  const theme = useThemeStore((s) => s.resolved);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decoCollectionRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const allNotesRef = useRef<NoteSummary[]>(allNotes);
  allNotesRef.current = allNotes;
  const onWikilinkOpenRef = useRef(onWikilinkOpen);
  onWikilinkOpenRef.current = onWikilinkOpen;

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState(note?.title ?? "");
  const [body, setBody] = useState(note?.body ?? "");
  const [tags, setTags] = useState<string[]>(note?.tags ?? []);
  const [tagDraft, setTagDraft] = useState("");
  const [status, setStatus] = useState<SaveStatus>(isDraft ? "idle" : "saved");
  const [statusError, setStatusError] = useState<string | null>(null);

  // Sync when the parent swaps the open note.
  const noteKey = note ? note.slug + ":" + note.updated : isDraft ? "__draft__" : "__none__";
  useEffect(() => {
    setTitle(note?.title ?? "");
    setBody(note?.body ?? "");
    setTags(note?.tags ?? []);
    setStatus(isDraft ? "idle" : "saved");
    setStatusError(null);
    if (isDraft && initialFocusTitle) {
      // Defer so the input is mounted.
      requestAnimationFrame(() => titleInputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey]);

  // ----- Monaco lifecycle -----
  useEffect(() => {
    if (!containerRef.current) return;
    monaco.editor.defineTheme(monacoThemeFor(theme).name, monacoThemeFor(theme));
    const editor = monaco.editor.create(containerRef.current, {
      value: note?.body ?? "",
      language: "markdown",
      theme: monacoThemeFor(theme).name,
      wordWrap: "on",
      minimap: { enabled: false },
      fontSize: 14,
      fontFamily: "var(--font-mono)",
      lineNumbers: "off",
      glyphMargin: false,
      folding: false,
      lineDecorationsWidth: 8,
      lineNumbersMinChars: 0,
      padding: { top: 14, bottom: 14 },
      scrollBeyondLastLine: false,
      renderLineHighlight: "none",
      automaticLayout: true,
      stickyScroll: { enabled: false },
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => {
      const next = editor.getValue();
      setBody(next);
      setStatus((s) => (s === "saving" ? "saving" : "dirty"));
    });

    // Click on a wikilink decoration → open it.
    const mouseSub = editor.onMouseDown((e) => {
      const pos = e.target.position;
      if (!pos) return;
      const model = editor.getModel();
      if (!model) return;
      const text = model.getValue();
      WIKILINK_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = WIKILINK_RE.exec(text)) !== null) {
        const start = model.getPositionAt(m.index);
        const end = model.getPositionAt(m.index + m[0].length);
        const inside =
          (pos.lineNumber > start.lineNumber ||
            (pos.lineNumber === start.lineNumber && pos.column >= start.column)) &&
          (pos.lineNumber < end.lineNumber ||
            (pos.lineNumber === end.lineNumber && pos.column <= end.column));
        if (inside) {
          e.event.preventDefault();
          onWikilinkOpenRef.current(m[1].trim());
          return;
        }
      }
    });

    // Register for STT dictation injection.
    const editorId = `kn-editor-${Math.random().toString(36).slice(2, 8)}`;
    registerEditor(editorId, editor);

    return () => {
      sub.dispose();
      mouseSub.dispose();
      unregisterEditor(editorId);
      editor.dispose();
      editorRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync body into the editor when the parent swaps the note (without
  // re-creating the editor — we keep view state).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const incoming = note?.body ?? "";
    if (editor.getValue() !== incoming) {
      editor.setValue(incoming);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteKey]);

  // Theme follow.
  useEffect(() => {
    const t = monacoThemeFor(theme);
    monaco.editor.defineTheme(t.name, t);
    monaco.editor.setTheme(t.name);
  }, [theme]);

  // ----- Wikilink decorations -----
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    const knownSlugs = new Set<string>();
    const knownTitlesLower = new Map<string, string>();
    for (const n of allNotesRef.current) {
      knownSlugs.add(n.slug);
      knownTitlesLower.set(n.title.toLowerCase(), n.slug);
    }
    const decos: monaco.editor.IModelDeltaDecoration[] = [];
    const text = model.getValue();
    WIKILINK_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WIKILINK_RE.exec(text)) !== null) {
      const startPos = model.getPositionAt(m.index);
      const endPos = model.getPositionAt(m.index + m[0].length);
      const ref = m[1].trim();
      const resolved =
        knownSlugs.has(ref) ||
        knownTitlesLower.has(ref.toLowerCase()) ||
        knownSlugs.has(slugify(ref));
      decos.push({
        range: new monaco.Range(
          startPos.lineNumber,
          startPos.column,
          endPos.lineNumber,
          endPos.column,
        ),
        options: {
          inlineClassName: resolved
            ? "kn-wikilink-inline"
            : "kn-wikilink-inline-unresolved",
          hoverMessage: resolved
            ? { value: `Click to open: ${ref}` }
            : { value: `Unresolved link. Click to create: ${ref}` },
        },
      });
    }
    if (decoCollectionRef.current) {
      decoCollectionRef.current.set(decos);
    } else {
      decoCollectionRef.current = editor.createDecorationsCollection(decos);
    }
  }, [body, allNotes]);

  // ----- `[[` completion provider (registered once globally) -----
  useEffect(() => {
    const provider = monaco.languages.registerCompletionItemProvider("markdown", {
      triggerCharacters: ["["],
      provideCompletionItems: (model, position) => {
        const line = model.getLineContent(position.lineNumber);
        const upToCursor = line.slice(0, position.column - 1);
        // Trigger only when the two chars before the cursor are `[[`.
        const match = upToCursor.match(/\[\[([^\]\n]*)$/);
        if (!match) return { suggestions: [] };
        const prefix = match[1].toLowerCase();
        const word = model.getWordUntilPosition(position);
        const range: monaco.IRange = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endColumn: position.column,
        };
        const suggestions = allNotesRef.current
          .filter((n) => !prefix || n.title.toLowerCase().includes(prefix))
          .slice(0, 20)
          .map((n) => ({
            label: n.title,
            kind: monaco.languages.CompletionItemKind.Reference,
            insertText: `${n.title}]]`,
            detail: n.slug,
            range,
          }));
        return { suggestions };
      },
    });
    return () => provider.dispose();
  }, []);

  // ----- Auto-save (debounced 800ms after last change) -----
  useEffect(() => {
    if (status !== "dirty") return;
    const handle = window.setTimeout(() => void doSave(), 800);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, title, body, tags]);

  async function doSave() {
    if (!title.trim() && !body.trim()) return;
    setStatus("saving");
    setStatusError(null);
    try {
      await onSave({
        title: title.trim() || "Untitled",
        body,
        tags,
        slug: note?.slug,
      });
      setStatus("saved");
    } catch (e) {
      setStatus("error");
      setStatusError(e instanceof Error ? e.message : String(e));
    }
  }

  function commitTagDraft() {
    const t = tagDraft.trim().replace(/[,\s]+$/g, "");
    if (!t) return;
    if (!tags.includes(t)) {
      setTags([...tags, t]);
      setStatus("dirty");
    }
    setTagDraft("");
  }

  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0;

  return (
    <div className="kn-editor" aria-label="Note editor">
      <input
        ref={titleInputRef}
        type="text"
        className="kn-title-input"
        value={title}
        placeholder="Untitled"
        onChange={(e) => {
          setTitle(e.target.value);
          setStatus("dirty");
        }}
        onBlur={() => {
          if (status === "dirty") void doSave();
        }}
        aria-label="Note title"
      />

      <div className="kn-tags">
        {tags.map((t) => (
          <span key={t} className="kn-tag">
            #{t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              onClick={() => {
                setTags(tags.filter((x) => x !== t));
                setStatus("dirty");
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          type="text"
          className="kn-tag-input"
          value={tagDraft}
          placeholder="+ tag"
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commitTagDraft();
            } else if (e.key === "Backspace" && tagDraft === "" && tags.length) {
              setTags(tags.slice(0, -1));
              setStatus("dirty");
            }
          }}
          onBlur={commitTagDraft}
          aria-label="Add tag"
        />
      </div>

      <div ref={containerRef} className="kn-monaco" />

      <div className="kn-foot" role="status" aria-live="polite">
        <span className={"kn-status " + (status === "idle" ? "" : status)}>
          <span className="dot" aria-hidden />
          {status === "saving"
            ? "Saving…"
            : status === "saved"
              ? "Saved"
              : status === "dirty"
                ? "Unsaved"
                : status === "error"
                  ? `Save failed${statusError ? ` — ${statusError}` : ""}`
                  : "Ready"}
          {status === "error" && (
            <button
              type="button"
              className="kn-rail-create"
              style={{ marginLeft: 6 }}
              onClick={() => void doSave()}
            >
              Retry
            </button>
          )}
        </span>
        <span>
          {wordCount} word{wordCount === 1 ? "" : "s"}
          {note && note.updated
            ? ` · updated ${new Date(note.updated).toLocaleTimeString()}`
            : ""}
        </span>
      </div>
    </div>
  );
}

/** Used by the parent to ask the editor to flush before navigating. */
export function noteEditorPlaceholderInitialSlug(title: string): string {
  return slugify(title);
}
