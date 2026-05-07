// Module-level registry that lets non-React callers (e.g. Super Brain) reach
// into a live xterm Terminal to read its OSC 133 command blocks. Mirrors the
// pattern used by editorRegistry for Monaco — Terminal.tsx registers on mount
// and unregisters on unmount; readers always see fresh state because the
// getBlocks closure points at Terminal.tsx's blocksRef.

import type { Terminal as XTerm } from "@xterm/xterm";
import type { CommandBlock } from "./osc133";
import { extractOutput } from "./blockBuffer";

type TerminalEntry = {
  term: XTerm;
  getBlocks: () => CommandBlock[];
  getSessionId: () => string | null;
  handleDrop: (paths: string[]) => void;
};

const entries = new Map<string, TerminalEntry>();

export function registerTerminal(paneId: string, entry: TerminalEntry): void {
  entries.set(paneId, entry);
}

export function unregisterTerminal(paneId: string): void {
  entries.delete(paneId);
}

export function dispatchDropToPane(paneId: string, paths: string[]): boolean {
  const e = entries.get(paneId);
  if (!e) return false;
  e.handleDrop(paths);
  return true;
}

// Predicate used by the in-app drag (screenshot stack) to know whether a
// pane should highlight as a drop target. Mirrors `dispatchDropToPane` but
// without side effects.
export function paneAcceptsDrop(paneId: string): boolean {
  return entries.has(paneId);
}

export type TerminalContext = {
  command: string;
  output: string;
  exitCode?: number;
  sessionId: string;
};

// Lightweight lookup for callers that only need to write to the PTY (e.g.
// write_pane, team_send_to_pane, voice fan-out). Avoids the OSC-133-completed-
// block requirement that getTerminalContext imposes — a fresh terminal with no
// finished command yet still has a live sessionId we can write into.
export function getTerminalSessionId(paneId: string): string | null {
  const e = entries.get(paneId);
  if (!e) return null;
  return e.getSessionId();
}

// Returns the most recent finished command block (with extracted output) for
// the given pane, or null if no completed block is available — e.g. fresh
// terminal that hasn't run anything yet, or buffer-evicted scrollback.
export function getTerminalContext(paneId: string): TerminalContext | null {
  const e = entries.get(paneId);
  if (!e) return null;
  const sid = e.getSessionId();
  if (!sid) return null;
  const blocks = e.getBlocks();
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.outputStartRow == null || b.endRow == null) continue;
    const output = extractOutput(e.term, b);
    if (output == null) continue;
    return {
      command: b.command ?? "",
      output,
      exitCode: b.exitCode,
      sessionId: sid,
    };
  }
  return null;
}

export type TerminalScreen = {
  /** "alternate" when a TUI app (vim, less, claude code, …) holds the screen,
   *  "normal" otherwise. Alt-screen has no scrollback. */
  bufferType: "normal" | "alternate";
  /** The trailing rows of the active buffer rendered as text. For alt-screen
   *  this is the full TUI; for normal-screen it's the visible viewport (plus
   *  whatever extra scrollback `rows` requested). Trailing blank lines are
   *  trimmed for compactness. */
  screen: string;
  /** Latest finished OSC 133 command, when one exists in the block history. */
  lastCommand: string | null;
  /** Exit code of `lastCommand`. */
  lastExitCode: number | null;
  /** State of the most recent block, regardless of whether output extraction
   *  succeeded. */
  lastBlockState: "prompting" | "running" | "finished" | null;
  sessionId: string;
};

// Reads what is currently on the terminal — the live xterm buffer — instead
// of waiting for an OSC 133 D (commandEnd) like getTerminalContext does. This
// is what the Super Agent's read_pane_output should use, because interactive
// TUI programs (claude code, vim, top, …) never emit a "finished" event so
// the OSC-133-only path returns null even when the screen is full of text.
//
// `rows` defaults to the visible viewport size (term.rows). Pass a larger
// value to scoop additional scrollback off the normal buffer.
export function getTerminalScreen(
  paneId: string,
  rows?: number,
): TerminalScreen | null {
  const e = entries.get(paneId);
  if (!e) return null;
  const sid = e.getSessionId();
  if (!sid) return null;

  const term = e.term;
  const buf = term.buffer.active;
  const bufferType: "normal" | "alternate" = buf.type;

  const want = Math.max(1, rows ?? term.rows);
  const total = buf.length;
  const start = Math.max(0, total - want);
  const lines: string[] = [];
  for (let i = start; i < total; i++) {
    const line = buf.getLine(i);
    lines.push(line ? line.translateToString(true) : "");
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();

  let lastCommand: string | null = null;
  let lastExitCode: number | null = null;
  let lastBlockState: TerminalScreen["lastBlockState"] = null;
  const blocks = e.getBlocks();
  if (blocks.length > 0) {
    lastBlockState = blocks[blocks.length - 1].state;
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.state === "finished") {
        lastCommand = b.command ?? null;
        lastExitCode = b.exitCode ?? null;
        break;
      }
    }
  }

  return {
    bufferType,
    screen: lines.join("\n"),
    lastCommand,
    lastExitCode,
    lastBlockState,
    sessionId: sid,
  };
}
