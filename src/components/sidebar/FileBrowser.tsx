import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { fsListDirRecursive, type FileEntry } from "../../lib/tauri";
import type { Pane } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";

type Props = { pane: Pane; tabId: string };

export function FileBrowser({ pane, tabId }: Props) {
  const root = pane.payload?.root as string | undefined;
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const setPaneKind = useWorkspaceStore((s) => s.setPaneKind);
  const tab = tabs.find((t) => t.id === tabId);

  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((path: string) => {
    setLoading(true);
    setError(null);
    fsListDirRecursive(path, 4)
      .then((list) => setEntries(list))
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (root) load(root);
  }, [root, load]);

  const filtered = useMemo(() => {
    if (!filter) return entries.slice(0, 1000);
    const f = filter.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(f) || e.path.toLowerCase().includes(f)).slice(0, 1000);
  }, [entries, filter]);

  const pickRoot = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setPanePayload(tabId, pane.id, { root: selected });
    }
  };

  const openInEditor = (entry: FileEntry) => {
    if (entry.isDir) return;
    if (!tab) return;
    // Find an editor pane already open, otherwise convert this pane's "neighbor" into one.
    const editorPane = Object.values(tab.panes).find((p) => p.kind === "editor");
    if (editorPane) {
      setPanePayload(tabId, editorPane.id, { path: entry.path });
    } else {
      // Fallback: convert the file-browser pane itself.
      setPaneKind(tabId, pane.id, "editor", { path: entry.path });
    }
  };

  return (
    <div className="filebrowser">
      <div className="fb-bar">
        <button className="btn btn-ghost" onClick={pickRoot}>
          {root ? "Change root" : "Pick folder"}
        </button>
        {root && (
          <input
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="fb-filter"
          />
        )}
      </div>
      {!root && (
        <div className="fb-empty">No folder selected. Pick a project root to start browsing.</div>
      )}
      {root && (
        <div className="fb-list scrollbar">
          {loading && <div className="fb-row muted">Loading…</div>}
          {error && <div className="fb-row danger">Error: {error}</div>}
          {!loading && filtered.map((e) => (
            <div
              key={e.path}
              className={"fb-row" + (e.isDir ? " dir" : "")}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData("text/plain", e.path);
              }}
              onDoubleClick={() => openInEditor(e)}
              title={e.path}
            >
              <span className="fb-icon">{e.isDir ? "▸" : "·"}</span>
              <span className="fb-name">{e.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
