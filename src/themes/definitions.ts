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

const ansi = {
  void: {
    black: "#1a1d29",
    red: "#ef4f6f",
    green: "#2ee29a",
    yellow: "#f7b955",
    blue: "#5cc8ff",
    magenta: "#c98aff",
    cyan: "#5fe5d8",
    white: "#cdd2dd",
    brightBlack: "#3a405a",
    brightRed: "#ff7390",
    brightGreen: "#5ff0b4",
    brightYellow: "#ffd07a",
    brightBlue: "#88d6ff",
    brightMagenta: "#dca4ff",
    brightCyan: "#80efe2",
    brightWhite: "#ffffff",
  },
  dracula: {
    black: "#21222c",
    red: "#ff5555",
    green: "#50fa7b",
    yellow: "#f1fa8c",
    blue: "#bd93f9",
    magenta: "#ff79c6",
    cyan: "#8be9fd",
    white: "#f8f8f2",
    brightBlack: "#6272a4",
    brightRed: "#ff6e6e",
    brightGreen: "#69ff94",
    brightYellow: "#ffffa5",
    brightBlue: "#d6acff",
    brightMagenta: "#ff92df",
    brightCyan: "#a4ffff",
    brightWhite: "#ffffff",
  },
  synthwave: {
    black: "#241b2f",
    red: "#fe4450",
    green: "#72f1b8",
    yellow: "#fede5d",
    blue: "#36f9f6",
    magenta: "#ff7edb",
    cyan: "#03edf9",
    white: "#f1f1f1",
    brightBlack: "#495495",
    brightRed: "#ff8b94",
    brightGreen: "#9bf2c0",
    brightYellow: "#ffe57a",
    brightBlue: "#83fffd",
    brightMagenta: "#ffa3e3",
    brightCyan: "#7afdfd",
    brightWhite: "#ffffff",
  },
  paper: {
    black: "#222222",
    red: "#c5454f",
    green: "#5a9b58",
    yellow: "#b58a3e",
    blue: "#3d7eb1",
    magenta: "#9c5dab",
    cyan: "#3a8e8e",
    white: "#cccccc",
    brightBlack: "#666666",
    brightRed: "#d65f6a",
    brightGreen: "#6fb86d",
    brightYellow: "#cea25a",
    brightBlue: "#5b96c2",
    brightMagenta: "#b27cbf",
    brightCyan: "#5cabab",
    brightWhite: "#ffffff",
  },
  solar: {
    black: "#073642",
    red: "#dc322f",
    green: "#859900",
    yellow: "#b58900",
    blue: "#268bd2",
    magenta: "#d33682",
    cyan: "#2aa198",
    white: "#eee8d5",
    brightBlack: "#586e75",
    brightRed: "#cb4b16",
    brightGreen: "#586e75",
    brightYellow: "#657b83",
    brightBlue: "#839496",
    brightMagenta: "#6c71c4",
    brightCyan: "#93a1a1",
    brightWhite: "#fdf6e3",
  },
};

export const themes: Theme[] = [
  {
    id: "void",
    name: "Void",
    kind: "dark",
    ui: {
      bg: "#0b0d12",
      bgElev: "#14171f",
      bgElev2: "#1c2030",
      fg: "#e6e8ef",
      fgMuted: "#98a2b3",
      fgDim: "#5b6478",
      border: "#232838",
      borderStrong: "#2e3447",
      accent: "#7c5cff",
      accentFg: "#ffffff",
      success: "#2ee29a",
      warning: "#f7b955",
      danger: "#ef4f6f",
      info: "#5cc8ff",
      shadow: "0 8px 32px rgba(0, 0, 0, 0.45)",
    },
    terminal: {
      background: "#0b0d12",
      foreground: "#e6e8ef",
      cursor: "#7c5cff",
      cursorAccent: "#0b0d12",
      selectionBackground: "#7c5cff66",
      ...ansi.void,
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    kind: "dark",
    ui: {
      bg: "#282a36",
      bgElev: "#21222c",
      bgElev2: "#343746",
      fg: "#f8f8f2",
      fgMuted: "#bdbdc4",
      fgDim: "#6272a4",
      border: "#44475a",
      borderStrong: "#6272a4",
      accent: "#bd93f9",
      accentFg: "#282a36",
      success: "#50fa7b",
      warning: "#f1fa8c",
      danger: "#ff5555",
      info: "#8be9fd",
      shadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
    },
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#bd93f966",
      ...ansi.dracula,
    },
  },
  {
    id: "synthwave",
    name: "Synthwave",
    kind: "dark",
    ui: {
      bg: "#241b2f",
      bgElev: "#1f1730",
      bgElev2: "#2d2342",
      fg: "#f1f1f1",
      fgMuted: "#bbaadf",
      fgDim: "#7e6aae",
      border: "#3a2c5a",
      borderStrong: "#5a3f8a",
      accent: "#ff7edb",
      accentFg: "#241b2f",
      success: "#72f1b8",
      warning: "#fede5d",
      danger: "#fe4450",
      info: "#03edf9",
      shadow: "0 0 32px rgba(255, 126, 219, 0.2)",
    },
    terminal: {
      background: "#241b2f",
      foreground: "#f1f1f1",
      cursor: "#ff7edb",
      cursorAccent: "#241b2f",
      selectionBackground: "#ff7edb55",
      ...ansi.synthwave,
    },
  },
  {
    id: "paper",
    name: "Paper",
    kind: "light",
    ui: {
      bg: "#fbf9f3",
      bgElev: "#f5f1e6",
      bgElev2: "#ece6d4",
      fg: "#222222",
      fgMuted: "#5e5e5e",
      fgDim: "#8a8a8a",
      border: "#d8cfb6",
      borderStrong: "#a89f86",
      accent: "#3d7eb1",
      accentFg: "#fbf9f3",
      success: "#5a9b58",
      warning: "#b58a3e",
      danger: "#c5454f",
      info: "#3a8e8e",
      shadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
    },
    terminal: {
      background: "#fbf9f3",
      foreground: "#222222",
      cursor: "#3d7eb1",
      cursorAccent: "#fbf9f3",
      selectionBackground: "#3d7eb133",
      ...ansi.paper,
    },
  },
  {
    id: "solar",
    name: "Solar",
    kind: "light",
    ui: {
      bg: "#fdf6e3",
      bgElev: "#eee8d5",
      bgElev2: "#e0dac6",
      fg: "#073642",
      fgMuted: "#586e75",
      fgDim: "#93a1a1",
      border: "#d6cfb8",
      borderStrong: "#a89f86",
      accent: "#268bd2",
      accentFg: "#fdf6e3",
      success: "#859900",
      warning: "#b58900",
      danger: "#dc322f",
      info: "#2aa198",
      shadow: "0 4px 16px rgba(0, 0, 0, 0.08)",
    },
    terminal: {
      background: "#fdf6e3",
      foreground: "#073642",
      cursor: "#268bd2",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#268bd233",
      ...ansi.solar,
    },
  },
];

export const themeById = (id: string) => themes.find((t) => t.id === id) ?? themes[0];
