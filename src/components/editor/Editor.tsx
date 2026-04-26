import { useEffect, useRef, useState } from "react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import CssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import HtmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import TsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useThemeStore } from "../../stores/themeStore";
import { monacoThemeFor } from "../../themes/apply";
import type { Pane } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { languageFor } from "./languages";
import { Icon } from "../ui/Icon";
import { registerEditor, unregisterEditor } from "../stt/editorRegistry";
import { editorFilesFrom, basename, parentDir } from "./editorPayload";
import { EditorTabs } from "./EditorTabs";
import { gitStatus, type GitStatusLetter } from "../../lib/tauri";

// Monaco needs a real Worker per language. Without this, JSON/TS modes
// fall through to the AMD loader path and crash on `moduleIdToUrl.toUrl`.
(self as unknown as { MonacoEnvironment: monaco.Environment }).MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case "json":
        return new JsonWorker();
      case "css":
      case "scss":
      case "less":
        return new CssWorker();
      case "html":
      case "handlebars":
      case "razor":
        return new HtmlWorker();
      case "typescript":
      case "javascript":
        return new TsWorker();
      default:
        return new EditorWorker();
    }
  },
};

// Module-scope: models are global to monaco, so dirty baselines are too.
// A file open in two panes shows the same dirty state in both — correct.
const savedVersions = new Map<string, number>();

function isModelDirty(path: string): boolean {
  const model = monaco.editor.getModel(monaco.Uri.file(path));
  if (!model) return false;
  return model.getAlternativeVersionId() !== (savedVersions.get(path) ?? 0);
}

type Props = { pane: Pane; tabId: string };

export function Editor({ pane, tabId }: Props) {
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const theme = useThemeStore((s) => s.current);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const viewStatesRef = useRef(
    new Map<string, monaco.editor.ICodeEditorViewState | null>(),
  );
  const [tick, setTick] = useState(0);
  const [confirmClose, setConfirmClose] = useState<{ path: string } | null>(null);
  const [gitMap, setGitMap] = useState<Record<string, GitStatusLetter>>({});

  const { files, activePath } = editorFilesFrom(pane.payload);
  const filesKey = files.join("\0");

  // Mount the editor once per pane.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const editor = monaco.editor.create(node, {
      automaticLayout: true,
      fontSize: 13,
      fontFamily:
        'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
      minimap: { enabled: false },
      scrollbar: { vertical: "auto", horizontal: "auto" },
      renderWhitespace: "selection",
      tabSize: 2,
      wordWrap: "on",
    });
    editorRef.current = editor;
    registerEditor(pane.id, editor);
    const id = pane.id;
    return () => {
      // Stash view state for the active model so re-mount restores it.
      const m = editor.getModel();
      if (m) viewStatesRef.current.set(m.uri.fsPath, editor.saveViewState());
      editor.dispose();
      editorRef.current = null;
      unregisterEditor(id);
      // Don't dispose models — they're shared globally and may be in use
      // by other Editor panes pointing at the same file.
    };
  }, [pane.id]);

  // Apply the Teamship-derived Monaco theme on every theme change.
  useEffect(() => {
    const def = monacoThemeFor(theme);
    monaco.editor.defineTheme(def.name, {
      base: def.base,
      inherit: def.inherit,
      rules: def.rules,
      colors: def.colors,
    });
    monaco.editor.setTheme(def.name);
  }, [theme]);

  // Swap models when activePath changes.
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;

    // Save the outgoing model's view state.
    const prev = editor.getModel();
    if (prev) viewStatesRef.current.set(prev.uri.fsPath, editor.saveViewState());

    if (!activePath) {
      editor.setModel(null);
      return;
    }

    const uri = monaco.Uri.file(activePath);
    const cached = monaco.editor.getModel(uri);
    if (cached) {
      editor.setModel(cached);
      const vs = viewStatesRef.current.get(activePath);
      if (vs) editor.restoreViewState(vs);
      editor.focus();
      return;
    }

    let cancelled = false;
    void readTextFile(activePath)
      .then((text) => {
        if (cancelled) return;
        const created = monaco.editor.createModel(
          text,
          languageFor(activePath),
          uri,
        );
        savedVersions.set(activePath, created.getAlternativeVersionId());
        editor.setModel(created);
        const vs = viewStatesRef.current.get(activePath);
        if (vs) editor.restoreViewState(vs);
        editor.focus();
        setTick((t) => t + 1);
      })
      .catch((e) => {
        if (cancelled) return;
        const created = monaco.editor.createModel(
          `// failed to read ${activePath}\n// ${e}`,
          "plaintext",
          uri,
        );
        editor.setModel(created);
      });
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  // Subscribe to whichever model the editor currently has — re-subscribe
  // whenever setModel runs (including the async path after a file read).
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    let contentSub: monaco.IDisposable | null = null;
    const subscribeToCurrent = () => {
      contentSub?.dispose();
      const model = editor.getModel();
      contentSub = model
        ? model.onDidChangeContent(() => setTick((t) => t + 1))
        : null;
    };
    subscribeToCurrent();
    const modelSub = editor.onDidChangeModel(subscribeToCurrent);
    return () => {
      contentSub?.dispose();
      modelSub.dispose();
    };
  }, []);

  // Poll git status for the parent dirs of all open files. Re-runs when
  // the file set changes; refreshGit() is also called after each save so
  // a Modified file flips to clean immediately.
  const refreshGit = async () => {
    if (files.length === 0) {
      setGitMap({});
      return;
    }
    const dirs = new Set(files.map(parentDir));
    const maps = await Promise.all(
      [...dirs].map((d) => gitStatus(d).catch(() => ({}))),
    );
    const merged: Record<string, GitStatusLetter> = {};
    for (const m of maps) Object.assign(merged, m);
    setGitMap(merged);
  };

  useEffect(() => {
    let cancelled = false;
    if (files.length === 0) {
      setGitMap({});
      return;
    }
    const dirs = new Set(files.map(parentDir));
    void Promise.all(
      [...dirs].map((d) => gitStatus(d).catch(() => ({}))),
    ).then((maps) => {
      if (cancelled) return;
      const merged: Record<string, GitStatusLetter> = {};
      for (const m of maps) Object.assign(merged, m);
      setGitMap(merged);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesKey]);

  // Cmd/Ctrl+S to save the active file.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || (e.key !== "s" && e.key !== "S")) return;
      if (!activePath) return;
      const editor = editorRef.current;
      const model = editor?.getModel();
      if (!model) return;
      // Only consume the keystroke when this pane has focus, so other
      // panes (or document-level handlers) can still respond when focus
      // is elsewhere.
      const node = containerRef.current;
      const active = document.activeElement;
      if (!node || !(node.contains(active) || node === active)) return;
      e.preventDefault();
      const value = model.getValue();
      void writeTextFile(activePath, value)
        .then(() => {
          savedVersions.set(activePath, model.getAlternativeVersionId());
          setTick((t) => t + 1);
          void refreshGit();
        })
        .catch((err) => console.warn("[editor] save failed", err));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePath]);

  const setPayload = (next: { files: string[]; activePath: string | null }) => {
    // Strip the legacy `path` key so it doesn't shadow the new shape.
    setPanePayload(tabId, pane.id, {
      ...pane.payload,
      files: next.files,
      activePath: next.activePath,
      path: undefined,
    });
  };

  const switchTab = (path: string) => {
    if (path === activePath) return;
    setPayload({ files, activePath: path });
  };

  const doCloseTab = (path: string) => {
    const remaining = files.filter((p) => p !== path);
    let nextActive: string | null = activePath;
    if (activePath === path) {
      const idx = files.indexOf(path);
      nextActive = remaining[idx] ?? remaining[idx - 1] ?? null;
    }
    setPayload({ files: remaining, activePath: nextActive });
    viewStatesRef.current.delete(path);
  };

  const closeTab = (path: string) => {
    if (isModelDirty(path)) {
      setConfirmClose({ path });
      return;
    }
    doCloseTab(path);
  };

  const saveAndClose = async (path: string) => {
    const model = monaco.editor.getModel(monaco.Uri.file(path));
    if (model) {
      try {
        await writeTextFile(path, model.getValue());
        savedVersions.set(path, model.getAlternativeVersionId());
      } catch (e) {
        console.warn("[editor] save failed", e);
        return; // leave the tab + dialog up so the user notices
      }
    }
    doCloseTab(path);
    setConfirmClose(null);
    void refreshGit();
  };

  const discardAndClose = async (path: string) => {
    const model = monaco.editor.getModel(monaco.Uri.file(path));
    if (model) {
      try {
        const disk = await readTextFile(path);
        model.setValue(disk);
        savedVersions.set(path, model.getAlternativeVersionId());
      } catch (e) {
        console.warn("[editor] discard re-read failed", e);
      }
    }
    doCloseTab(path);
    setConfirmClose(null);
  };

  const addTab = async () => {
    const selected = await openDialog({ multiple: false });
    if (typeof selected !== "string") return;
    if (files.includes(selected)) {
      switchTab(selected);
      return;
    }
    setPayload({ files: [...files, selected], activePath: selected });
  };

  // Recompute dirty map on every render (tick changes via content listener).
  const dirtyMap: Record<string, boolean> = {};
  for (const f of files) dirtyMap[f] = isModelDirty(f);
  // Suppress unused-tick warning — read indirectly via the dirty recalc.
  void tick;

  if (files.length === 0) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-icon">
          <Icon name="file-edit" size={24} />
        </div>
        <div className="editor-empty-title">No file open</div>
        <div className="editor-empty-sub">
          Open a file from disk, or press <kbd>⌘P</kbd> for Quick Open.
        </div>
        <div className="editor-empty-actions">
          <button
            className="btn btn-primary btn-with-icon"
            onClick={addTab}
          >
            <Icon name="file" size={14} />
            <span>Open file…</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-wrap">
      <EditorTabs
        files={files}
        activePath={activePath}
        dirtyMap={dirtyMap}
        gitMap={gitMap}
        onSwitch={switchTab}
        onClose={closeTab}
        onAdd={addTab}
      />
      <div className="editor-host" ref={containerRef} />
      {confirmClose && (
        <UnsavedConfirm
          path={confirmClose.path}
          onCancel={() => setConfirmClose(null)}
          onDiscard={() => void discardAndClose(confirmClose.path)}
          onSave={() => void saveAndClose(confirmClose.path)}
        />
      )}
    </div>
  );
}

function UnsavedConfirm({
  path,
  onCancel,
  onDiscard,
  onSave,
}: {
  path: string;
  onCancel: () => void;
  onDiscard: () => void;
  onSave: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal narrow"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-title">Unsaved changes</div>
        <div className="modal-body">
          <code>{basename(path)}</code> has unsaved changes. Save them before
          closing?
        </div>
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-ghost" onClick={onDiscard}>
            Discard
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onSave}
            autoFocus
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
