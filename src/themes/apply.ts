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

/** Build a Monaco theme definition from a Teamship theme. */
export function monacoThemeFor(theme: Theme): {
  name: string;
  base: "vs" | "vs-dark";
  inherit: boolean;
  rules: Array<{ token: string; foreground?: string; background?: string; fontStyle?: string }>;
  colors: Record<string, string>;
} {
  return {
    name: `teamship-${theme.id}`,
    base: theme.kind === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [
      { token: "comment", foreground: theme.ui.fgDim.replace("#", ""), fontStyle: "italic" },
      { token: "keyword", foreground: theme.ui.accent.replace("#", "") },
      { token: "string", foreground: theme.terminal.green.replace("#", "") },
      { token: "number", foreground: theme.terminal.yellow.replace("#", "") },
      { token: "type", foreground: theme.terminal.cyan.replace("#", "") },
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
