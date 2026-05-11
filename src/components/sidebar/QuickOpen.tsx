import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Searcher } from "fast-fuzzy";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { fsListDirRecursive, settingsGet, settingsSet, type FileEntry } from "../../lib/tauri";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { registerShortcut } from "../../lib/shortcuts";
import { useFocusReturn } from "../../lib/useFocusReturn";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { useHideBrowsersWhile } from "../../lib/useHideBrowsersWhile";
import { Icon } from "../ui/Icon";
import { ErrorState } from "../ui/ErrorState";
import { editorFilesFrom } from "../editor/editorPayload";

export function QuickOpen() {
  const [open, setOpen] = useState(false);
  useFocusReturn(open);
  useHideBrowsersWhile(open);
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef, open);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const setPaneKind = useWorkspaceStore((s) => s.setPaneKind);

  // Open via shortcut
  useEffect(() => {
    const u = registerShortcut("quickOpen", () => setOpen(true));
    return u;
  }, []);

  // Restore last project root.
  useEffect(() => {
    void settingsGet<string>("quickOpenRoot").then((r) => {
      if (r) setRoot(r);
    });
  }, []);

  const indexFiles = useCallback((path: string) => {
    setError(null);
    void fsListDirRecursive(path, 5)
      .then((list) => setFiles(list.filter((f) => !f.isDir)))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (root) indexFiles(root);
  }, [open, root, indexFiles]);

  const searcher = useMemo(() => {
    return new Searcher(files, { keySelector: (f: FileEntry) => f.name + " " + f.path });
  }, [files]);
  const results: FileEntry[] = useMemo(() => {
    if (!query) return files.slice(0, 50);
    return searcher.search(query).slice(0, 50) as FileEntry[];
  }, [query, files, searcher]);

  const pickRoot = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setRoot(selected);
      void settingsSet("quickOpenRoot", selected);
    }
  };

  const openFile = (entry: FileEntry) => {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;
    const active = tab.activePaneId ? tab.panes[tab.activePaneId] : null;
    const editorPane =
      active && active.kind === "editor"
        ? active
        : Object.values(tab.panes).find((p) => p.kind === "editor");
    if (!editorPane) {
      const target = tab.activePaneId ?? Object.keys(tab.panes)[0];
      if (!target) return;
      setPaneKind(tab.id, target, "editor", {
        files: [entry.path],
        activePath: entry.path,
      });
    } else {
      const { files } = editorFilesFrom(editorPane.payload);
      const nextFiles = files.includes(entry.path)
        ? files
        : [...files, entry.path];
      setPanePayload(tab.id, editorPane.id, {
        ...editorPane.payload,
        files: nextFiles,
        activePath: entry.path,
        path: undefined,
      });
    }
    setOpen(false);
    setQuery("");
  };

  // Window-scoped Escape so users can close even if focus has wandered.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div
        ref={modalRef}
        className="modal quickopen"
        role="dialog"
        aria-modal="true"
        aria-label="Quick Open"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="quickopen-input-row">
          <div className="quickopen-input-wrap">
            <span className="quickopen-input-icon">
              <Icon name="search" size={14} />
            </span>
            <input
              ref={inputRef}
              aria-label="Search files"
              placeholder={root ? "Search files…" : "Pick a folder first"}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { setHighlight((h) => Math.min(h + 1, results.length - 1)); e.preventDefault(); }
                if (e.key === "ArrowUp") { setHighlight((h) => Math.max(0, h - 1)); e.preventDefault(); }
                if (e.key === "Enter") { const r = results[highlight]; if (r) openFile(r); }
              }}
            />
          </div>
          <button className="btn btn-ghost btn-with-icon" onClick={pickRoot}>
            <Icon name="folder" size={14} />
            <span>{root ? "Change root" : "Pick folder"}</span>
          </button>
        </div>
        {!root && (
          <div className="quickopen-empty">
            <Icon name="folder" size={20} />
            <div>Pick a project folder to index its files for fast search.</div>
          </div>
        )}
        {root && error && (
          <ErrorState
            compact
            title="Couldn't index this folder"
            message={error}
            onRetry={() => indexFiles(root)}
          />
        )}
        {root && !error && (
          <div className="quickopen-list scrollbar">
            {results.map((r, i) => (
              <div
                key={r.path}
                className={"quickopen-row" + (i === highlight ? " active" : "")}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => openFile(r)}
              >
                <span className="qo-name">{r.name}</span>
                <span className="qo-path">{r.path.replace(root, "").replace(/^\//, "")}</span>
              </div>
            ))}
            {results.length === 0 && query && (
              <div className="quickopen-empty">
                <Icon name="search" size={20} />
                <div>No matches for “{query}”</div>
              </div>
            )}
          </div>
        )}
        <div className="quickopen-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
