// `data-platform` is stamped on <html> in `main.tsx` from `navigator.userAgent`
// at app start. Reading the dataset attribute is cheaper than re-running the
// regex per call and keeps the source of truth in one place.

export type Platform = "macos" | "windows" | "linux";

function get(): Platform {
  if (typeof document === "undefined") return "linux";
  const v = document.documentElement.dataset.platform;
  return v === "macos" || v === "windows" ? v : "linux";
}

export const isWindows = (): boolean => get() === "windows";
export const isMacPlatform = (): boolean => get() === "macos";
export const isLinux = (): boolean => get() === "linux";
