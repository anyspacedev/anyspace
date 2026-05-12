export type ThemeKind = "dark" | "light";

export type UiTokens = {
  bg: string;
  bgElev: string;
  bgElev2: string;
  fg: string;
  fgMuted: string;
  fgDim: string;
  border: string;
  borderStrong: string;
  accent: string;
  accentFg: string;
  success: string;
  warning: string;
  danger: string;
  dangerFg: string;
  info: string;
  shadow: string;
};

// xterm.js ITheme shape, kept as a plain object so we don't import xterm here.
export type XtermTheme = {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
};

export type Theme = {
  id: string;
  name: string;
  kind: ThemeKind;
  ui: UiTokens;
  terminal: XtermTheme;
};

export const lightTheme: Theme = {
  id: "light",
  name: "Light",
  kind: "light",
  ui: {
    bg: "#ffffff",
    bgElev: "#fafafa",
    bgElev2: "#f4f4f5",
    fg: "#0a0a0a",
    fgMuted: "#525252",
    fgDim: "#a3a3a3",
    border: "#e5e5e5",
    borderStrong: "#d4d4d4",
    accent: "#0a0a0a",
    accentFg: "#ffffff",
    success: "#15803d",
    warning: "#b45309",
    danger: "#b91c1c",
    dangerFg: "#ffffff",
    info: "#1d4ed8",
    shadow: "0 1px 3px rgba(0, 0, 0, 0.08), 0 4px 16px rgba(0, 0, 0, 0.06)",
  },
  terminal: {
    background: "#ffffff",
    foreground: "#0a0a0a",
    cursor: "#0a0a0a",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(10, 10, 10, 0.15)",
    black: "#0a0a0a",
    red: "#b91c1c",
    green: "#15803d",
    yellow: "#b45309",
    blue: "#1d4ed8",
    magenta: "#7e22ce",
    cyan: "#0e7490",
    white: "#e5e5e5",
    brightBlack: "#525252",
    brightRed: "#dc2626",
    brightGreen: "#16a34a",
    brightYellow: "#d97706",
    brightBlue: "#2563eb",
    brightMagenta: "#9333ea",
    brightCyan: "#0891b2",
    brightWhite: "#ffffff",
  },
};

export const darkTheme: Theme = {
  id: "dark",
  name: "Dark",
  kind: "dark",
  ui: {
    bg: "#0a0a0a",
    bgElev: "#171717",
    bgElev2: "#262626",
    fg: "#fafafa",
    fgMuted: "#a3a3a3",
    fgDim: "#737373",
    border: "#262626",
    borderStrong: "#404040",
    accent: "#fafafa",
    accentFg: "#0a0a0a",
    success: "#4ade80",
    warning: "#fbbf24",
    danger: "#f87171",
    dangerFg: "#0a0a0a",
    info: "#60a5fa",
    shadow: "0 8px 32px rgba(0, 0, 0, 0.6)",
  },
  terminal: {
    background: "#0a0a0a",
    foreground: "#fafafa",
    cursor: "#fafafa",
    cursorAccent: "#0a0a0a",
    selectionBackground: "rgba(250, 250, 250, 0.18)",
    black: "#262626",
    red: "#f87171",
    green: "#4ade80",
    yellow: "#fbbf24",
    blue: "#60a5fa",
    magenta: "#c084fc",
    cyan: "#22d3ee",
    white: "#e5e5e5",
    brightBlack: "#525252",
    brightRed: "#fca5a5",
    brightGreen: "#86efac",
    brightYellow: "#fcd34d",
    brightBlue: "#93c5fd",
    brightMagenta: "#d8b4fe",
    brightCyan: "#67e8f9",
    brightWhite: "#fafafa",
  },
};

export const themes: Theme[] = [lightTheme, darkTheme];

export const themeById = (id: string): Theme => {
  if (id === "light") return lightTheme;
  return darkTheme;
};

export function resolveSystemTheme(): Theme {
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? darkTheme : lightTheme;
  }
  return darkTheme;
}
