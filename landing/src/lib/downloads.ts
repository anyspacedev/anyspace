import type { OSName } from "./detectOS";

// Single source of truth — rewritten by .github/workflows/release.yml on every tag.
// Keep `LATEST_VERSION = "..."` on its own line; the workflow's sed targets it literally.
export const LATEST_VERSION = "0.1.1";

export const DOWNLOAD_BASE = "https://get.anyspace.dev";

const v = LATEST_VERSION;

export const DOWNLOADS = {
  macArm64:    `${DOWNLOAD_BASE}/v${v}/AnySpace-${v}-mac-arm64.dmg`,
  macX64:      `${DOWNLOAD_BASE}/v${v}/AnySpace-${v}-mac-x64.dmg`,
  windowsX64:  `${DOWNLOAD_BASE}/v${v}/AnySpace-${v}-windows-x64.msi`,
  linuxDeb:    `${DOWNLOAD_BASE}/v${v}/AnySpace-${v}-linux-x64.deb`,
  linuxAppImg: `${DOWNLOAD_BASE}/v${v}/AnySpace-${v}-linux-x64.AppImage`,
} as const;

export function downloadFor(os: OSName): string {
  switch (os) {
    case "macOS":   return DOWNLOADS.macArm64;
    case "Windows": return DOWNLOADS.windowsX64;
    case "Linux":   return DOWNLOADS.linuxDeb;
    default:        return "#download";
  }
}
