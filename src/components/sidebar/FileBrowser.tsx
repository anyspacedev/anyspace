import { useCallback, useEffect, useMemo, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { fsListDirRecursive, type FileEntry } from "../../lib/tauri";
import type { Pane } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Icon } from "../ui/Icon";
import { ErrorState } from "../ui/ErrorState";
import { editorFilesFrom } from "../editor/editorPayload";

type Props = { pane: Pane; tabId: string };

export function FileBrowser({ pane, tabId }: Props) {
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const setPaneKind = useWorkspaceStore((s) => s.setPaneKind);
  const setTabProjectPath = useWorkspaceStore((s) => s.setTabProjectPath);
  const tab = tabs.find((t) => t.id === tabId);
  const root = tab?.projectPath;

  const pickWorkspaceFolder = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: root,
      title: "Choose workspace folder",
    });
    if (typeof selected === "string") setTabProjectPath(tabId, selected);
  };

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
    else setEntries([]);
  }, [root, load]);

  const filtered = useMemo(() => {
    if (!filter) return entries.slice(0, 1000);
    const f = filter.toLowerCase();
    return entries.filter((e) => e.name.toLowerCase().includes(f) || e.path.toLowerCase().includes(f)).slice(0, 1000);
  }, [entries, filter]);

  const openInEditor = (entry: FileEntry) => {
    if (entry.isDir) return;
    if (!tab) return;
    // Prefer the focused pane if it's an editor; otherwise the first editor pane.
    const active = tab.activePaneId ? tab.panes[tab.activePaneId] : null;
    const editorPane =
      active && active.kind === "editor"
        ? active
        : Object.values(tab.panes).find((p) => p.kind === "editor");
    if (editorPane) {
      const { files } = editorFilesFrom(editorPane.payload);
      const nextFiles = files.includes(entry.path)
        ? files
        : [...files, entry.path];
      setPanePayload(tabId, editorPane.id, {
        ...editorPane.payload,
        files: nextFiles,
        activePath: entry.path,
        path: undefined,
      });
    } else {
      // No editor pane in this tab — convert the file-browser pane.
      setPaneKind(tabId, pane.id, "editor", {
        files: [entry.path],
        activePath: entry.path,
      });
    }
  };

  return (
    <div className="filebrowser">
      {root && (
        <div className="fb-bar">
          <span className="fb-root" title={root}>
            <Icon name="folder-tree" size={13} />
            <span className="fb-root-path">{root}</span>
          </span>
          <input
            aria-label="Filter files"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="fb-filter"
          />
        </div>
      )}
      {!root && (
        <div className="fb-empty">
          <Icon name="folder-tree" size={20} />
          <div>This workspace has no project folder set.</div>
          <button
            type="button"
            className="btn btn-primary btn-with-icon"
            onClick={pickWorkspaceFolder}
          >
            <Icon name="folder-tree" size={13} />
            <span>Choose project folder…</span>
          </button>
          <div className="fb-empty-hint">
            The Files pane and new terminals will use this folder.
          </div>
        </div>
      )}
      {root && error && (
        <ErrorState
          compact
          title="Couldn't list files"
          message={error}
          onRetry={() => load(root)}
        />
      )}
      {root && !error && (
        <div className="fb-list scrollbar">
          {loading && (
            <div className="fb-loading" role="status" aria-live="polite">
              <span className="ai-explain-spinner" aria-hidden />
              <span>Loading…</span>
            </div>
          )}
          {!loading && filtered.map((e) => (
            <div
              key={e.path}
              className={"fb-row" + (e.isDir ? " dir" : "")}
              role="button"
              tabIndex={0}
              draggable
              onDragStart={(ev) => {
                ev.dataTransfer.setData("text/plain", e.path);
              }}
              onDoubleClick={() => openInEditor(e)}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  openInEditor(e);
                }
              }}
              title={e.path}
              aria-label={(e.isDir ? "Folder " : "File ") + e.name}
            >
              <span className="fb-icon">
                <Icon name={e.isDir ? "folder" : "file"} size={13} />
              </span>
              <span className="fb-name">{e.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
