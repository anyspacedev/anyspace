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

// Compact ANSI palette helper — every theme provides 16 ANSI colors.
const ansi: Record<string, Omit<XtermTheme, "background" | "foreground" | "cursor" | "cursorAccent" | "selectionBackground">> = {
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

// ===== Extended palette: 20 more themes to reach the spec's 25+ =====
// Each entry uses a compact builder that derives missing pieces from UI tokens.

type CompactAnsi = {
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
};

function expandAnsi(a: CompactAnsi) {
  // Brighten by ~18% via crude hex math — good enough for terminal accents.
  const brighten = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * 1.18 + 12));
    const g = Math.min(255, Math.round(((n >> 8) & 255) * 1.18 + 12));
    const b = Math.min(255, Math.round((n & 255) * 1.18 + 12));
    return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
  };
  return {
    black: a.black, red: a.red, green: a.green, yellow: a.yellow,
    blue: a.blue, magenta: a.magenta, cyan: a.cyan, white: a.white,
    brightBlack: brighten(a.black),
    brightRed: brighten(a.red),
    brightGreen: brighten(a.green),
    brightYellow: brighten(a.yellow),
    brightBlue: brighten(a.blue),
    brightMagenta: brighten(a.magenta),
    brightCyan: brighten(a.cyan),
    brightWhite: brighten(a.white),
  };
}

function mk(opts: {
  id: string; name: string; kind: ThemeKind;
  bg: string; bgElev: string; bgElev2: string;
  fg: string; fgMuted: string; fgDim: string;
  border: string; borderStrong: string;
  accent: string; accentFg: string;
  success: string; warning: string; danger: string; info: string;
  ansi: CompactAnsi;
}): Theme {
  return {
    id: opts.id,
    name: opts.name,
    kind: opts.kind,
    ui: {
      bg: opts.bg, bgElev: opts.bgElev, bgElev2: opts.bgElev2,
      fg: opts.fg, fgMuted: opts.fgMuted, fgDim: opts.fgDim,
      border: opts.border, borderStrong: opts.borderStrong,
      accent: opts.accent, accentFg: opts.accentFg,
      success: opts.success, warning: opts.warning, danger: opts.danger, info: opts.info,
      shadow: opts.kind === "dark"
        ? "0 8px 32px rgba(0, 0, 0, 0.45)"
        : "0 4px 16px rgba(0, 0, 0, 0.08)",
    },
    terminal: {
      background: opts.bg,
      foreground: opts.fg,
      cursor: opts.accent,
      cursorAccent: opts.bg,
      selectionBackground: opts.accent + "44",
      ...expandAnsi(opts.ansi),
    },
  };
}

const extras: Theme[] = [
  // ----- Dark themes -----
  mk({
    id: "ghost", name: "Ghost", kind: "dark",
    bg: "#0a0a0a", bgElev: "#141414", bgElev2: "#1f1f1f",
    fg: "#e8e8e8", fgMuted: "#9a9a9a", fgDim: "#555",
    border: "#262626", borderStrong: "#3a3a3a",
    accent: "#a8a8a8", accentFg: "#0a0a0a",
    success: "#7fbf7f", warning: "#d8a85a", danger: "#d97070", info: "#7faecf",
    ansi: { black: "#1f1f1f", red: "#d97070", green: "#7fbf7f", yellow: "#d8a85a",
            blue: "#7faecf", magenta: "#b58fd6", cyan: "#7fc8c8", white: "#e8e8e8" },
  }),
  mk({
    id: "plasma", name: "Plasma", kind: "dark",
    bg: "#15101f", bgElev: "#1d1530", bgElev2: "#28203f",
    fg: "#f0e7ff", fgMuted: "#a99ad0", fgDim: "#6a5d8a",
    border: "#3a2e5e", borderStrong: "#5b4787",
    accent: "#d566ff", accentFg: "#15101f",
    success: "#5fff9b", warning: "#ffc857", danger: "#ff5c8a", info: "#5cc8ff",
    ansi: { black: "#28203f", red: "#ff5c8a", green: "#5fff9b", yellow: "#ffc857",
            blue: "#7fb3ff", magenta: "#d566ff", cyan: "#5cead4", white: "#f0e7ff" },
  }),
  mk({
    id: "carbon", name: "Carbon", kind: "dark",
    bg: "#161616", bgElev: "#1f1f1f", bgElev2: "#2a2a2a",
    fg: "#f4f4f4", fgMuted: "#a8a8a8", fgDim: "#6f6f6f",
    border: "#393939", borderStrong: "#525252",
    accent: "#4589ff", accentFg: "#ffffff",
    success: "#42be65", warning: "#f1c21b", danger: "#fa4d56", info: "#33b1ff",
    ansi: { black: "#262626", red: "#fa4d56", green: "#42be65", yellow: "#f1c21b",
            blue: "#4589ff", magenta: "#be95ff", cyan: "#33b1ff", white: "#f4f4f4" },
  }),
  mk({
    id: "hex", name: "Hex", kind: "dark",
    bg: "#0c1019", bgElev: "#141a26", bgElev2: "#1f2738",
    fg: "#dde6f0", fgMuted: "#8b97ad", fgDim: "#535e74",
    border: "#202c40", borderStrong: "#34425a",
    accent: "#5ec6f9", accentFg: "#0c1019",
    success: "#6ddc8b", warning: "#f7c46a", danger: "#ff5d5d", info: "#5ec6f9",
    ansi: { black: "#1f2738", red: "#ff5d5d", green: "#6ddc8b", yellow: "#f7c46a",
            blue: "#5ec6f9", magenta: "#c285ff", cyan: "#5fe1d8", white: "#dde6f0" },
  }),
  mk({
    id: "neon-tokyo", name: "Neon Tokyo", kind: "dark",
    bg: "#1a1b26", bgElev: "#1f2335", bgElev2: "#292e42",
    fg: "#c0caf5", fgMuted: "#9aa5ce", fgDim: "#565f89",
    border: "#2a2f48", borderStrong: "#3b4261",
    accent: "#bb9af7", accentFg: "#1a1b26",
    success: "#9ece6a", warning: "#e0af68", danger: "#f7768e", info: "#7dcfff",
    ansi: { black: "#1f2335", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
            blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#c0caf5" },
  }),
  mk({
    id: "obsidian", name: "Obsidian", kind: "dark",
    bg: "#0d1117", bgElev: "#161b22", bgElev2: "#21262d",
    fg: "#c9d1d9", fgMuted: "#8b949e", fgDim: "#484f58",
    border: "#30363d", borderStrong: "#484f58",
    accent: "#58a6ff", accentFg: "#0d1117",
    success: "#3fb950", warning: "#d29922", danger: "#f85149", info: "#58a6ff",
    ansi: { black: "#161b22", red: "#f85149", green: "#3fb950", yellow: "#d29922",
            blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#c9d1d9" },
  }),
  mk({
    id: "nebula", name: "Nebula", kind: "dark",
    bg: "#101327", bgElev: "#181d39", bgElev2: "#22294e",
    fg: "#e8e9ff", fgMuted: "#a0a4d6", fgDim: "#5a5f95",
    border: "#262d54", borderStrong: "#3a4280",
    accent: "#9d6cff", accentFg: "#101327",
    success: "#5fffba", warning: "#ffcd5e", danger: "#ff5e86", info: "#5ec3ff",
    ansi: { black: "#22294e", red: "#ff5e86", green: "#5fffba", yellow: "#ffcd5e",
            blue: "#5ec3ff", magenta: "#9d6cff", cyan: "#7be0d3", white: "#e8e9ff" },
  }),
  mk({
    id: "storm", name: "Storm", kind: "dark",
    bg: "#1f2335", bgElev: "#24283b", bgElev2: "#2d3148",
    fg: "#c0caf5", fgMuted: "#a9b1d6", fgDim: "#565f89",
    border: "#343a52", borderStrong: "#414868",
    accent: "#7dcfff", accentFg: "#1f2335",
    success: "#9ece6a", warning: "#e0af68", danger: "#f7768e", info: "#7dcfff",
    ansi: { black: "#2d3148", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68",
            blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#c0caf5" },
  }),
  mk({
    id: "infrared", name: "Infrared", kind: "dark",
    bg: "#1a0808", bgElev: "#240e0e", bgElev2: "#311414",
    fg: "#ffe6e6", fgMuted: "#d49494", fgDim: "#7d4848",
    border: "#3d1d1d", borderStrong: "#5e2929",
    accent: "#ff5c5c", accentFg: "#1a0808",
    success: "#ffac5c", warning: "#ffe35c", danger: "#ff3838", info: "#ff8a5c",
    ansi: { black: "#311414", red: "#ff5c5c", green: "#ffac5c", yellow: "#ffe35c",
            blue: "#ff8a5c", magenta: "#ff5cd7", cyan: "#ffc05c", white: "#ffe6e6" },
  }),
  mk({
    id: "nova", name: "Nova", kind: "dark",
    bg: "#0e141b", bgElev: "#171f29", bgElev2: "#222d3d",
    fg: "#dee5ed", fgMuted: "#9aa6b8", fgDim: "#566476",
    border: "#283342", borderStrong: "#3a475a",
    accent: "#f49b3a", accentFg: "#0e141b",
    success: "#7ec48f", warning: "#f4c64a", danger: "#df616a", info: "#5db8d9",
    ansi: { black: "#222d3d", red: "#df616a", green: "#7ec48f", yellow: "#f4c64a",
            blue: "#5db8d9", magenta: "#c992c9", cyan: "#7fcccc", white: "#dee5ed" },
  }),
  mk({
    id: "stealth", name: "Stealth", kind: "dark",
    bg: "#000000", bgElev: "#0a0a0a", bgElev2: "#141414",
    fg: "#dcdcdc", fgMuted: "#878787", fgDim: "#4a4a4a",
    border: "#1c1c1c", borderStrong: "#303030",
    accent: "#00ff88", accentFg: "#000000",
    success: "#00ff88", warning: "#ffce4f", danger: "#ff3a4f", info: "#00d2ff",
    ansi: { black: "#0a0a0a", red: "#ff3a4f", green: "#00ff88", yellow: "#ffce4f",
            blue: "#00d2ff", magenta: "#ff5ee6", cyan: "#00f5d4", white: "#dcdcdc" },
  }),
  mk({
    id: "hologram", name: "Hologram", kind: "dark",
    bg: "#0d1b1e", bgElev: "#142428", bgElev2: "#1e3338",
    fg: "#dff7fa", fgMuted: "#80c4cc", fgDim: "#4a777e",
    border: "#1b3a40", borderStrong: "#2a5860",
    accent: "#5cffe8", accentFg: "#0d1b1e",
    success: "#5cff8b", warning: "#ffd05c", danger: "#ff6b94", info: "#5cffe8",
    ansi: { black: "#1e3338", red: "#ff6b94", green: "#5cff8b", yellow: "#ffd05c",
            blue: "#5cb3ff", magenta: "#b35cff", cyan: "#5cffe8", white: "#dff7fa" },
  }),
  mk({
    id: "bridgemind", name: "BridgeMind", kind: "dark",
    bg: "#0e0d1a", bgElev: "#161528", bgElev2: "#22203a",
    fg: "#ebe8ff", fgMuted: "#9d9ad0", fgDim: "#5b598a",
    border: "#2b2746", borderStrong: "#403c69",
    accent: "#a78bfa", accentFg: "#0e0d1a",
    success: "#5fffa3", warning: "#ffd95c", danger: "#ff5c7e", info: "#5cc8ff",
    ansi: { black: "#22203a", red: "#ff5c7e", green: "#5fffa3", yellow: "#ffd95c",
            blue: "#5cc8ff", magenta: "#a78bfa", cyan: "#7fffd4", white: "#ebe8ff" },
  }),
  mk({
    id: "cybernetics", name: "Cybernetics", kind: "dark",
    bg: "#0a0e1a", bgElev: "#101728", bgElev2: "#19223d",
    fg: "#cae3ff", fgMuted: "#8aa6cc", fgDim: "#4d6485",
    border: "#1d2a47", borderStrong: "#2e4470",
    accent: "#00d9ff", accentFg: "#0a0e1a",
    success: "#5cffaf", warning: "#ffce4f", danger: "#ff4f7a", info: "#00d9ff",
    ansi: { black: "#19223d", red: "#ff4f7a", green: "#5cffaf", yellow: "#ffce4f",
            blue: "#00d9ff", magenta: "#c45cff", cyan: "#5cffe6", white: "#cae3ff" },
  }),
  mk({
    id: "quantum", name: "Quantum", kind: "dark",
    bg: "#0c0d20", bgElev: "#141532", bgElev2: "#1f2148",
    fg: "#dde0ff", fgMuted: "#9498d6", fgDim: "#525791",
    border: "#252852", borderStrong: "#3b407c",
    accent: "#7c5cff", accentFg: "#0c0d20",
    success: "#5fffb1", warning: "#ffcc5f", danger: "#ff5d8a", info: "#5fc4ff",
    ansi: { black: "#1f2148", red: "#ff5d8a", green: "#5fffb1", yellow: "#ffcc5f",
            blue: "#5fc4ff", magenta: "#7c5cff", cyan: "#5fe6e6", white: "#dde0ff" },
  }),
  mk({
    id: "mecha", name: "Mecha", kind: "dark",
    bg: "#171a21", bgElev: "#1d2129", bgElev2: "#262b35",
    fg: "#dadde3", fgMuted: "#9097a4", fgDim: "#555c69",
    border: "#2f3540", borderStrong: "#444c5a",
    accent: "#ff9933", accentFg: "#171a21",
    success: "#7fc28d", warning: "#e6c25a", danger: "#e85a5a", info: "#5db5d9",
    ansi: { black: "#262b35", red: "#e85a5a", green: "#7fc28d", yellow: "#e6c25a",
            blue: "#5db5d9", magenta: "#b888d6", cyan: "#5fc7c7", white: "#dadde3" },
  }),
  mk({
    id: "abyss", name: "Abyss", kind: "dark",
    bg: "#000c18", bgElev: "#001226", bgElev2: "#001b38",
    fg: "#cce0f4", fgMuted: "#7ea2c4", fgDim: "#3f6080",
    border: "#003366", borderStrong: "#005599",
    accent: "#22aaff", accentFg: "#000c18",
    success: "#3fffae", warning: "#ffcc44", danger: "#ff5577", info: "#22aaff",
    ansi: { black: "#001b38", red: "#ff5577", green: "#3fffae", yellow: "#ffcc44",
            blue: "#22aaff", magenta: "#aa55ff", cyan: "#3fffea", white: "#cce0f4" },
  }),

  // ----- Light themes -----
  mk({
    id: "chalk", name: "Chalk", kind: "light",
    bg: "#f4f1ea", bgElev: "#ebe7dd", bgElev2: "#e0dbcc",
    fg: "#2a2a2a", fgMuted: "#5e5950", fgDim: "#8a857a",
    border: "#d2cdba", borderStrong: "#9d9786",
    accent: "#5a6e9a", accentFg: "#f4f1ea",
    success: "#5e8c4a", warning: "#a87a3a", danger: "#a83e4a", info: "#3e7a8c",
    ansi: { black: "#2a2a2a", red: "#a83e4a", green: "#5e8c4a", yellow: "#a87a3a",
            blue: "#5a6e9a", magenta: "#9555a8", cyan: "#3e8a8a", white: "#cdcdcd" },
  }),
  mk({
    id: "arctic", name: "Arctic", kind: "light",
    bg: "#eff1f5", bgElev: "#e6e9ef", bgElev2: "#dce0e8",
    fg: "#4c4f69", fgMuted: "#6c6f85", fgDim: "#9ca0b0",
    border: "#bcc0cc", borderStrong: "#7c7f93",
    accent: "#7287fd", accentFg: "#eff1f5",
    success: "#40a02b", warning: "#df8e1d", danger: "#d20f39", info: "#04a5e5",
    ansi: { black: "#5c5f77", red: "#d20f39", green: "#40a02b", yellow: "#df8e1d",
            blue: "#1e66f5", magenta: "#8839ef", cyan: "#179299", white: "#eff1f5" },
  }),
  mk({
    id: "ivory", name: "Ivory", kind: "light",
    bg: "#fffcf2", bgElev: "#f7f3e3", bgElev2: "#ece6cf",
    fg: "#252422", fgMuted: "#5c5b58", fgDim: "#94928d",
    border: "#d4ceb6", borderStrong: "#a39e89",
    accent: "#cc7a3b", accentFg: "#fffcf2",
    success: "#637c4f", warning: "#cc9a3b", danger: "#c14e4e", info: "#3b7e8a",
    ansi: { black: "#252422", red: "#c14e4e", green: "#637c4f", yellow: "#cc9a3b",
            blue: "#3b7e8a", magenta: "#9a5dab", cyan: "#3b8a85", white: "#dad5c5" },
  }),
];

themes.push(...extras);

export const themeById = (id: string) => themes.find((t) => t.id === id) ?? themes[0];
