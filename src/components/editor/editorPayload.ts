// Normalizes a Pane.payload into the multi-file editor shape.
// Existing single-file payloads ({ path }) round-trip through this helper
// so persisted state from before tabs landed still opens correctly.

export type EditorPayload = {
  files: string[];
  activePath: string | null;
};

export function editorFilesFrom(
  payload: Record<string, unknown> | undefined,
): EditorPayload {
  const filesRaw = payload?.files;
  if (Array.isArray(filesRaw) && filesRaw.every((f) => typeof f === "string")) {
    const files = filesRaw as string[];
    const activeRaw = payload?.activePath;
    const activePath =
      typeof activeRaw === "string" && files.includes(activeRaw)
        ? activeRaw
        : files[files.length - 1] ?? null;
    return { files, activePath };
  }
  const path = payload?.path;
  if (typeof path === "string") {
    return { files: [path], activePath: path };
  }
  return { files: [], activePath: null };
}

export function basename(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx >= 0 ? path.slice(idx + 1) : path;
}
