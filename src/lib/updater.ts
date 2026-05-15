/**
 * Thin wrapper over `@tauri-apps/plugin-updater`.
 *
 * The plugin is configured in `src-tauri/tauri.conf.json` to hit our backend
 * (`https://api.anyspace.dev/updates/{target}/{arch}/{current_version}`), which
 * returns either 204 (up to date) or a Tauri v2 manifest. This file exposes
 * three things to the rest of the desktop app:
 *
 *   1. `UpdaterState` — discriminated union the store + UI reads.
 *   2. `checkForUpdate()` — one-shot HTTP check. Caches the `Update` resource
 *      so `downloadAndApply()` can reuse it without re-checking.
 *   3. `downloadAndApply()` — downloads, verifies, installs. Calls a progress
 *      callback so the status-bar pill can show a progress bar.
 *
 * Install triggers a relaunch — `@tauri-apps/plugin-updater`'s `install()`
 * stops the running process and starts the new binary. No silent install
 * paths; this only runs when the user clicks the affordance.
 */

import { check, type Update } from "@tauri-apps/plugin-updater";

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "available"; version: string; notes: string; pubDate?: string }
  | { phase: "downloading"; downloaded: number; total: number }
  | { phase: "ready" }                                       // applied; relaunch imminent
  | { phase: "error"; message: string };

// Holds the `Update` resource between `checkForUpdate()` and
// `downloadAndApply()` calls so the user's click on "Install" doesn't
// require a second HTTP round-trip to GitHub for the signature.
let pending: Update | null = null;

export async function checkForUpdate(): Promise<UpdaterState> {
  try {
    const u = await check({ timeout: 10_000 });
    if (!u) {
      pending = null;
      return { phase: "idle" };
    }
    pending = u;
    return {
      phase: "available",
      version: u.version,
      notes: u.body ?? "",
      pubDate: u.date,
    };
  } catch (e) {
    return { phase: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

export async function downloadAndApply(
  onProgress: (s: UpdaterState) => void,
): Promise<UpdaterState> {
  if (!pending) {
    return { phase: "error", message: "no pending update — run check first" };
  }
  let total = 0;
  let downloaded = 0;
  try {
    await pending.downloadAndInstall((ev) => {
      if (ev.event === "Started") {
        total = ev.data.contentLength ?? 0;
        onProgress({ phase: "downloading", downloaded: 0, total });
      } else if (ev.event === "Progress") {
        downloaded += ev.data.chunkLength;
        onProgress({ phase: "downloading", downloaded, total });
      } else if (ev.event === "Finished") {
        // `install()` will relaunch shortly — render "ready" so the UI shows
        // a final state while the process is being replaced.
        onProgress({ phase: "ready" });
      }
    });
    return { phase: "ready" };
  } catch (e) {
    return { phase: "error", message: e instanceof Error ? e.message : String(e) };
  }
}

/** True if a check has already found an upgrade waiting to be applied. */
export function hasPending(): boolean {
  return pending !== null;
}
