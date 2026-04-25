import { useEffect, useRef, useState } from "react";
import MonacoEditor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useThemeStore } from "../../stores/themeStore";
import { monacoThemeFor } from "../../themes/apply";
import type { Pane } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { languageFor } from "./languages";

// Wire monaco loader to use the bundled instance (offline-capable).
loader.config({ monaco });

type Props = { pane: Pane; tabId: string };

export function Editor({ pane, tabId }: Props) {
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const theme = useThemeStore((s) => s.current);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const [content, setContent] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const path = pane.payload?.path as string | undefined;

  // Define + apply a Monaco theme for this Teamship theme.
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

  // Load file when path changes
  useEffect(() => {
    if (!path) {
      setContent("");
      return;
    }
    void readTextFile(path)
      .then((text) => {
        setContent(text);
        setDirty(false);
      })
      .catch((e) => {
        setContent(`// failed to read ${path}\n// ${e}`);
      });
  }, [path]);

  // Cmd/Ctrl+S to save.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        if (!path) return;
        const value = editorRef.current?.getValue() ?? content;
        void writeTextFile(path, value)
          .then(() => {
            setDirty(false);
            setSavedAt(Date.now());
          })
          .catch((err) => console.warn("[editor] save failed", err));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [path, content]);

  if (!path) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-title">No file open</div>
        <div className="editor-empty-sub">
          Press <kbd>⌘P</kbd> to open Quick Open or pick a file:
        </div>
        <button
          className="btn"
          onClick={async () => {
            const selected = await openDialog({ multiple: false });
            if (typeof selected === "string") {
              setPanePayload(tabId, pane.id, { path: selected });
            }
          }}
        >
          Open file…
        </button>
      </div>
    );
  }

  return (
    <div className="editor-wrap">
      <div className="editor-bar">
        <span className="editor-path">{path}</span>
        <span className="editor-status">
          {dirty ? "● modified" : savedAt ? "saved" : ""}
        </span>
      </div>
      <div className="editor-host">
        <MonacoEditor
          theme={`teamship-${theme.id}`}
          language={languageFor(path)}
          value={content}
          onChange={(v) => {
            setContent(v ?? "");
            setDirty(true);
          }}
          onMount={(editor) => {
            editorRef.current = editor;
          }}
          options={{
            fontSize: 13,
            fontFamily: 'ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
            minimap: { enabled: false },
            scrollbar: { vertical: "auto", horizontal: "auto" },
            renderWhitespace: "selection",
            tabSize: 2,
            automaticLayout: true,
            wordWrap: "on",
          }}
        />
      </div>
    </div>
  );
}
