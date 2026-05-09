export type ThemeMode = "light" | "dark";

const STORAGE_KEY = "anyspace.theme";

export function getStoredTheme(): ThemeMode | null {
  if (typeof window === "undefined") return null;
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "light" || v === "dark" ? v : null;
}

export function getSystemTheme(): ThemeMode {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getActiveTheme(): ThemeMode {
  return getStoredTheme() ?? getSystemTheme();
}

export function setTheme(mode: ThemeMode) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, mode);
  document.documentElement.classList.toggle("dark", mode === "dark");
  window.dispatchEvent(new CustomEvent("anyspace:theme", { detail: mode }));
}

export function toggleTheme() {
  setTheme(getActiveTheme() === "dark" ? "light" : "dark");
}

export const THEME_STORAGE_KEY = STORAGE_KEY;
