// BOARD.md helpers — outline scanning + append-into-section.
//
// BOARD.md is freely edited by operators and team agents after the seed in
// buildBoardMarkdown(); structured parsing of the seeded sections is brittle
// in the face of heading-level drift and Coordinator restructures. So we keep
// reads to a best-effort outline (model parses sections itself) and writes to
// append-only insertion before the next sibling heading.

import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";

export type BoardOutlineEntry = {
  heading: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Byte offset of the line start in `raw`. UTF-16 length, but JS string
   *  indexing is uniform so the model can substring(byteOffset, ...) directly. */
  byteOffset: number;
  /** 1-indexed line number. */
  lineNumber: number;
};

export type BoardSnapshot = {
  raw: string;
  outline: BoardOutlineEntry[];
  exists: boolean;
};

/** Single-pass scan of `^#{1,6}\s+`. Treats fenced code blocks as opaque so
 *  `# this is a comment` inside a ```sh fence doesn't show up as a heading. */
export function scanOutline(content: string): BoardOutlineEntry[] {
  const out: BoardOutlineEntry[] = [];
  const lines = content.split(/\r?\n/);
  let inFence = false;
  let fenceMarker = "";
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    if (!inFence) {
      if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
        inFence = true;
        fenceMarker = trimmed.startsWith("```") ? "```" : "~~~";
      } else {
        const m = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
        if (m) {
          const level = m[1].length as 1 | 2 | 3 | 4 | 5 | 6;
          out.push({
            heading: m[2],
            level,
            byteOffset: offset,
            lineNumber: i + 1,
          });
        }
      }
    } else if (trimmed.startsWith(fenceMarker)) {
      inFence = false;
      fenceMarker = "";
    }
    // +1 for the \n we split on (best-effort; CRLF off by one byte but the
    // outline is informational, not seek-positional for binary writes).
    offset += line.length + 1;
  }
  return out;
}

export async function readBoard(boardPath: string): Promise<BoardSnapshot> {
  let raw = "";
  let exists = true;
  try {
    raw = await readTextFile(boardPath);
  } catch {
    exists = false;
  }
  return { raw, outline: scanOutline(raw), exists };
}

const SECTION_TITLES = {
  task_breakdown: "Task Breakdown",
  agent_status: "Agent Status",
  completed_work: "Completed Work Log",
  attachments: "Attachments",
} as const;

export type BoardSection = keyof typeof SECTION_TITLES;

/** Find the byte range of a section: from the heading line itself to the
 *  byte-offset of the next sibling-or-shallower heading (or EOF). Returns
 *  null if the section heading isn't present in the outline. */
function findSectionBounds(
  outline: BoardOutlineEntry[],
  raw: string,
  title: string,
  level: number = 2,
): { headingStart: number; bodyStart: number; bodyEnd: number; entry: BoardOutlineEntry } | null {
  // Match by case-insensitive trimmed heading at the requested level.
  const idx = outline.findIndex(
    (e) => e.level === level && e.heading.trim().toLowerCase() === title.toLowerCase(),
  );
  if (idx === -1) return null;
  const entry = outline[idx];
  // bodyStart = end of the heading line (next line start).
  const lineEnd = raw.indexOf("\n", entry.byteOffset);
  const bodyStart = lineEnd === -1 ? raw.length : lineEnd + 1;
  // bodyEnd = next heading at same or shallower level, else EOF.
  let bodyEnd = raw.length;
  for (let j = idx + 1; j < outline.length; j++) {
    if (outline[j].level <= level) {
      bodyEnd = outline[j].byteOffset;
      break;
    }
  }
  return { headingStart: entry.byteOffset, bodyStart, bodyEnd, entry };
}

/** Find the byte range of an `### <label>` block inside an `## Agent Status`
 *  section. The block ends at the next ### or the section's bodyEnd. */
function findAgentStatusBlock(
  outline: BoardOutlineEntry[],
  raw: string,
  label: string,
  sectionBodyEnd: number,
): { headingStart: number; bodyStart: number; bodyEnd: number } | null {
  // Match `### <label> (...)`. Both the seeded form `### Builder (Builder)`
  // and an operator's `### Builder` should match — accept either.
  const targetExact = label.toLowerCase();
  for (let i = 0; i < outline.length; i++) {
    const e = outline[i];
    if (e.level !== 3) continue;
    if (e.byteOffset >= sectionBodyEnd) break;
    const h = e.heading.trim().toLowerCase();
    if (h === targetExact || h.startsWith(`${targetExact} (`)) {
      const lineEnd = raw.indexOf("\n", e.byteOffset);
      const bodyStart = lineEnd === -1 ? raw.length : lineEnd + 1;
      let bodyEnd = sectionBodyEnd;
      for (let j = i + 1; j < outline.length; j++) {
        if (outline[j].byteOffset >= sectionBodyEnd) break;
        if (outline[j].level <= 3) {
          bodyEnd = outline[j].byteOffset;
          break;
        }
      }
      return { headingStart: e.byteOffset, bodyStart, bodyEnd };
    }
  }
  return null;
}

export type AppendBoardEntryArgs = {
  boardPath: string;
  section: BoardSection;
  /** Required when section === "agent_status". */
  label?: string;
  content: string;
  /** Prefix the entry with an ISO timestamp marker. Default true. */
  timestamp?: boolean;
};

export type AppendBoardEntryResult = {
  insertedAtByte: number;
  appendedSectionHeading: boolean;
  appendedAgentBlock: boolean;
};

/** Insert `content` near the end of the named section. Append-only by design;
 *  we never overwrite existing rows or the seeded `_WAITING_` placeholder.
 *  When the section is missing, append a new `## <Title>` block at EOF. */
export async function appendBoardEntry(args: AppendBoardEntryArgs): Promise<AppendBoardEntryResult> {
  const { boardPath, section, label, content } = args;
  const ts = args.timestamp !== false;
  const title = SECTION_TITLES[section];
  const stamped = ts ? `_${new Date().toISOString().replace(/\.\d+Z$/, "Z")}_ — ${content}` : content;

  let raw = "";
  try {
    raw = await readTextFile(boardPath);
  } catch {
    raw = "";
  }
  const outline = scanOutline(raw);
  const bounds = findSectionBounds(outline, raw, title, 2);

  if (!bounds) {
    // Section missing → append a fresh `## <Title>` block at EOF.
    const sep = raw.length === 0 || raw.endsWith("\n") ? "" : "\n";
    let block = `${sep}\n## ${title}\n`;
    if (section === "agent_status" && label) {
      block += `### ${label}\n${stamped}\n`;
    } else {
      block += `${stamped}\n`;
    }
    const next = raw + block;
    await writeTextFile(boardPath, next);
    return { insertedAtByte: raw.length, appendedSectionHeading: true, appendedAgentBlock: !!label };
  }

  let insertAt = bounds.bodyEnd;
  let appendedAgentBlock = false;

  if (section === "agent_status") {
    if (!label) throw new Error("agent_status requires a label");
    const block = findAgentStatusBlock(outline, raw, label, bounds.bodyEnd);
    if (block) {
      // Insert just before bodyEnd of the agent's `### <label>` block.
      insertAt = block.bodyEnd;
    } else {
      // No `### <label>` block — append a new one before bodyEnd.
      const before = raw.slice(0, bounds.bodyEnd);
      const sepBefore = before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
      const inserted = `${sepBefore}### ${label}\n${stamped}\n`;
      const next = before + inserted + raw.slice(bounds.bodyEnd);
      await writeTextFile(boardPath, next);
      return {
        insertedAtByte: before.length,
        appendedSectionHeading: false,
        appendedAgentBlock: true,
      };
    }
  }

  // Generic insert before bodyEnd. Trim trailing blank lines from the
  // section body so the entry sits flush rather than after a gap.
  const before = raw.slice(0, insertAt);
  const trimmed = before.replace(/\n+$/, "\n");
  const sepBefore = trimmed.endsWith("\n") ? "" : "\n";
  const entryText = `${sepBefore}${stamped}\n\n`;
  const next = trimmed + entryText + raw.slice(insertAt);
  await writeTextFile(boardPath, next);
  return {
    insertedAtByte: trimmed.length,
    appendedSectionHeading: false,
    appendedAgentBlock,
  };
}

/** Match the Rust label_slug() rule in src-tauri/src/team/commands.rs:338,
 *  which is also what tmsg.sh does. */
export function labelSlug(label: string): string {
  let out = "";
  for (const ch of label) {
    if (/[A-Za-z0-9_-]/.test(ch)) out += ch;
    else out += "_";
  }
  return out || "agent";
}
