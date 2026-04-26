// Module-level registry mapping paneId → Monaco editor instance.
// Editor.tsx registers on mount, unregisters on unmount; STT inject reads here.

import type { editor as monacoEditor } from "monaco-editor";

const editors = new Map<string, monacoEditor.IStandaloneCodeEditor>();

export function registerEditor(paneId: string, editor: monacoEditor.IStandaloneCodeEditor): void {
  editors.set(paneId, editor);
}

export function unregisterEditor(paneId: string): void {
  editors.delete(paneId);
}

export function getEditor(paneId: string): monacoEditor.IStandaloneCodeEditor | undefined {
  return editors.get(paneId);
}
