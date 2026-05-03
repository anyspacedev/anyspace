export type TeamMessage = {
  id: string;
  from: string;
  to: string;
  type: "message" | "status" | "escalation" | "done" | string;
  ts: string;
  body: string;
};

const HEADER = /^<!--\s*msg\s+(.+?)-->\s*$/;
const FOOTER = /^<!--\s*\/msg\s*-->\s*$/;

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Match key="value" pairs, handling escaped quotes inside.
  const re = /([a-zA-Z_][\w-]*)="((?:\\"|[^"])*)"/g;
  for (let m: RegExpExecArray | null; (m = re.exec(s)); ) {
    out[m[1]] = m[2].replace(/\\"/g, '"');
  }
  return out;
}

/**
 * Parse the append-only MESSAGES.md format produced by tmsg.sh:
 *
 *   <!-- msg id="..." from="..." to="..." type="..." ts="..." -->
 *   body line(s)
 *   <!-- /msg -->
 *
 * Anything outside fenced blocks is silently ignored.
 */
export function parseMessages(content: string): TeamMessage[] {
  const lines = content.split(/\r?\n/);
  const out: TeamMessage[] = [];
  let cur: TeamMessage | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const headerMatch = HEADER.exec(line);
    if (headerMatch) {
      const attrs = parseAttrs(headerMatch[1]);
      cur = {
        id: attrs.id ?? "",
        from: attrs.from ?? "",
        to: attrs.to ?? "",
        type: (attrs.type as TeamMessage["type"]) ?? "message",
        ts: attrs.ts ?? "",
        body: "",
      };
      buf = [];
      continue;
    }
    if (FOOTER.test(line)) {
      if (cur) {
        cur.body = buf.join("\n").replace(/^\n+|\n+$/g, "");
        out.push(cur);
      }
      cur = null;
      buf = [];
      continue;
    }
    if (cur) buf.push(line);
  }
  return out;
}
