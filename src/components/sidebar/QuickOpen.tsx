import { useEffect, useMemo, useRef, useState } from "react";
import { Searcher } from "fast-fuzzy";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { fsListDirRecursive, settingsGet, settingsSet, type FileEntry } from "../../lib/tauri";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { registerShortcut } from "../../lib/shortcuts";

export function QuickOpen() {
  const [open, setOpen] = useState(false);
  const [root, setRoot] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    if (root) {
      void fsListDirRecursive(root, 5)
        .then((list) => setFiles(list.filter((f) => !f.isDir)))
        .catch((e) => console.warn("[quickopen] list failed", e));
    }
  }, [open, root]);

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
    let editorPane = Object.values(tab.panes).find((p) => p.kind === "editor");
    if (!editorPane) {
      const target = tab.activePaneId ?? Object.keys(tab.panes)[0];
      if (!target) return;
      setPaneKind(tab.id, target, "editor", { path: entry.path });
    } else {
      setPanePayload(tab.id, editorPane.id, { path: entry.path });
    }
    setOpen(false);
    setQuery("");
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal quickopen" onClick={(e) => e.stopPropagation()}>
        <div className="quickopen-input-row">
          <input
            ref={inputRef}
            placeholder={root ? "Search files…" : "Pick a folder first"}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setHighlight(0); }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
              if (e.key === "ArrowDown") { setHighlight((h) => Math.min(h + 1, results.length - 1)); e.preventDefault(); }
              if (e.key === "ArrowUp") { setHighlight((h) => Math.max(0, h - 1)); e.preventDefault(); }
              if (e.key === "Enter") { const r = results[highlight]; if (r) openFile(r); }
            }}
          />
          <button className="btn btn-ghost" onClick={pickRoot}>{root ? "Change root" : "Pick folder"}</button>
        </div>
        {!root && <div className="quickopen-empty">No folder. Pick one to index files.</div>}
        {root && (
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
            {results.length === 0 && <div className="quickopen-empty">No matches</div>}
          </div>
        )}
      </div>
    </div>
  );
}
