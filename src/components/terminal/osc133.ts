// OSC 133 parser: tracks command blocks emitted by shell-integration scripts.
// Sequence semantics:
//   A — prompt start
//   B — prompt end / command start (the command being typed)
//   C — output start (cmd has been submitted)
//   D[;exit_code] — command finished

export type BlockState = "prompting" | "running" | "finished";

export type CommandBlock = {
  id: string;
  startRow: number;       // absolute buffer row (terminal._core.buffer.ydisp + viewport)
  outputStartRow?: number;
  endRow?: number;
  command?: string;
  exitCode?: number;
  state: BlockState;
  collapsed: boolean;
};

export type OscEvent =
  | { kind: "promptStart"; row: number }
  | { kind: "commandStart"; row: number }
  | { kind: "outputStart"; row: number }
  | { kind: "commandEnd"; row: number; exitCode?: number };

export function parseOsc133Payload(raw: string): OscEvent | null {
  // raw is the OSC 133 payload (without the prefix). e.g. "A", "B", "C", "D;0"
  const parts = raw.split(";");
  const code = parts[0];
  switch (code) {
    case "A": return { kind: "promptStart", row: -1 };
    case "B": return { kind: "commandStart", row: -1 };
    case "C": return { kind: "outputStart", row: -1 };
    case "D": {
      const exit = parts[1] !== undefined ? Number(parts[1]) : undefined;
      return { kind: "commandEnd", row: -1, exitCode: Number.isFinite(exit) ? exit : undefined };
    }
    default: return null;
  }
}

let blockCounter = 0;
const newBlockId = () => `blk_${++blockCounter}`;

/** Mutates `blocks` based on an event. Caller supplies the absolute row at the
 *  time the event fires (terminal.buffer.active.cursorY + ydisp).
 *  `capturedCommand` is consumed only for outputStart — it's the typed command
 *  text the caller extracted from the buffer right before output begins. */
export function applyEvent(
  blocks: CommandBlock[],
  evt: OscEvent,
  absRow: number,
  capturedCommand?: string,
): CommandBlock[] {
  switch (evt.kind) {
    case "promptStart":
      return [
        ...blocks,
        {
          id: newBlockId(),
          startRow: absRow,
          state: "prompting",
          collapsed: false,
        },
      ];
    case "commandStart": {
      const last = blocks[blocks.length - 1];
      if (!last) return blocks;
      return [...blocks.slice(0, -1), { ...last }];
    }
    case "outputStart": {
      const last = blocks[blocks.length - 1];
      if (!last) return blocks;
      const cmd = (capturedCommand ?? last.command ?? "").trim();
      // Empty command (user just hit Enter on a blank prompt). Drop the
      // prompting block instead of promoting it to a 1-row "running" block
      // that immediately becomes a stub finished block on the next D.
      if (!cmd) return blocks.slice(0, -1);
      return [
        ...blocks.slice(0, -1),
        {
          ...last,
          outputStartRow: absRow,
          state: "running",
          command: cmd,
        },
      ];
    }
    case "commandEnd": {
      const last = blocks[blocks.length - 1];
      if (!last) return blocks;
      return [
        ...blocks.slice(0, -1),
        { ...last, endRow: absRow, exitCode: evt.exitCode, state: "finished" },
      ];
    }
  }
}
