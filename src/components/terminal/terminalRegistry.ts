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
};

const entries = new Map<string, TerminalEntry>();

export function registerTerminal(paneId: string, entry: TerminalEntry): void {
  entries.set(paneId, entry);
}

export function unregisterTerminal(paneId: string): void {
  entries.delete(paneId);
}

export type TerminalContext = {
  command: string;
  output: string;
  exitCode?: number;
  sessionId: string;
};

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
