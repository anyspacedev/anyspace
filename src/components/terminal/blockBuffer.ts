// Buffer-reading utilities for OSC 133 command blocks.
//
// Blocks store absolute scrollback rows captured at event time
// (baseY + cursorY). We treat that "absRow" as a buffer index — same
// assumption the overlay positioning math in CommandBlocks.tsx makes.
// Past the 5000-row scrollback cap xterm starts evicting, indices shift,
// and lookups return null. Eager capture (called at the OSC 133;C
// boundary, before any eviction can happen) is always safe; lazy reads
// for very old blocks may return null and the UI should degrade.

import type { Terminal as XTerm } from "@xterm/xterm";
import type { CommandBlock } from "./osc133";

const PROMPT_TAILS = ["$ ", "% ", "# ", "> "];

function stripPrompt(line: string): string {
  let cut = -1;
  for (const tail of PROMPT_TAILS) {
    const idx = line.lastIndexOf(tail);
    const end = idx >= 0 ? idx + tail.length : -1;
    if (end > cut) cut = end;
  }
  return cut < 0 ? line : line.slice(cut);
}

export function readRows(
  term: XTerm,
  fromAbsRow: number,
  toAbsRowExclusive: number,
): string[] | null {
  if (fromAbsRow < 0 || toAbsRowExclusive <= fromAbsRow) return null;
  const buf = term.buffer.active;
  const out: string[] = [];
  for (let i = fromAbsRow; i < toAbsRowExclusive; i++) {
    if (i >= buf.length) break;
    const line = buf.getLine(i);
    if (!line) return null;
    out.push(line.translateToString(true));
  }
  return out;
}

export function extractCommand(
  term: XTerm,
  startRow: number,
  outputStartRow: number,
): string | null {
  if (outputStartRow <= startRow) return null;
  const rows = readRows(term, startRow, outputStartRow);
  if (!rows || rows.length === 0) return null;
  const joined = rows.map(stripPrompt).join("\n").trimEnd();
  return joined.length > 0 ? joined : null;
}

export function extractOutput(
  term: XTerm,
  block: CommandBlock,
): string | null {
  if (block.outputStartRow == null || block.endRow == null) return null;
  if (block.endRow <= block.outputStartRow) return "";
  const rows = readRows(term, block.outputStartRow, block.endRow);
  if (!rows) return null;
  let last = rows.length - 1;
  while (last >= 0 && rows[last].trim() === "") last--;
  return rows.slice(0, last + 1).join("\n");
}
