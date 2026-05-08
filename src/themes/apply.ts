import type { Theme } from "./definitions";

const KEY_TO_VAR: Record<string, string> = {
  bg: "--bg",
  bgElev: "--bg-elev",
  bgElev2: "--bg-elev-2",
  fg: "--fg",
  fgMuted: "--fg-muted",
  fgDim: "--fg-dim",
  border: "--border",
  borderStrong: "--border-strong",
  accent: "--accent",
  accentFg: "--accent-fg",
  success: "--success",
  warning: "--warning",
  danger: "--danger",
  dangerFg: "--danger-fg",
  info: "--info",
  shadow: "--shadow",
};

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  for (const [key, value] of Object.entries(theme.ui)) {
    const cssVar = KEY_TO_VAR[key];
    if (cssVar) root.style.setProperty(cssVar, value);
  }
  root.dataset.theme = theme.id;
  root.dataset.themeKind = theme.kind;
  root.style.colorScheme = theme.kind;
}

/** Strip "#" and expand 3-char hex to 6 — Monaco rejects 3-char tokens. */
function hex6(value: string): string {
  const v = value.replace("#", "");
  return v.length === 3 ? v.split("").map((c) => c + c).join("") : v;
}

/** Build a Monaco theme definition from a AnySpace theme. */
export function monacoThemeFor(theme: Theme): {
  name: string;
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: Array<{ token: string; foreground?: string; background?: string; fontStyle?: string }>;
  colors: Record<string, string>;
} {
  return {
    name: `anyspace-${theme.id}`,
    base: theme.kind === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: hex6(theme.ui.fgDim), fontStyle: "italic" },
      { token: "keyword", foreground: hex6(theme.ui.accent) },
      { token: "string", foreground: hex6(theme.terminal.green) },
      { token: "number", foreground: hex6(theme.terminal.yellow) },
      { token: "type", foreground: hex6(theme.terminal.cyan) },
    ],
    colors: {
      "editor.background": theme.ui.bg,
      "editor.foreground": theme.ui.fg,
      "editor.lineHighlightBackground": theme.ui.bgElev,
      "editorLineNumber.foreground": theme.ui.fgDim,
      "editorLineNumber.activeForeground": theme.ui.fgMuted,
      "editor.selectionBackground": theme.terminal.selectionBackground,
      "editorCursor.foreground": theme.ui.accent,
      "editorWidget.background": theme.ui.bgElev,
      "editorWidget.border": theme.ui.border,
    },
  };
}
