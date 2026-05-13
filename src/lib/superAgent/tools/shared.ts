/**
 * Shared utilities for adapting legacy Super Agent tools into Pi's
 * `AgentTool` shape. Phase 2 of the pi-agent-framework refactor.
 */

import { readFile } from "@tauri-apps/plugin-fs";

/** Read a file and return its base64 contents (no `data:` prefix). */
export async function pathToBase64(path: string): Promise<string | null> {
  try {
    const bytes = await readFile(path);
    const CHUNK = 0x8000;
    let str = "";
    for (let i = 0; i < bytes.length; i += CHUNK) {
      str += String.fromCharCode.apply(
        null,
        Array.from(bytes.subarray(i, i + CHUNK)),
      );
    }
    return btoa(str);
  } catch {
    return null;
  }
}

/** snake_case → Title Case for UI labels. */
export function humanLabel(name: string): string {
  return name
    .split("_")
    .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
