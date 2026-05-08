export type ElementCapture = {
  tag: string;
  id?: string;
  classes: string[];
  attributes: Record<string, string>;
  textPreview?: string;
  outerHTML: string;
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  parents: Array<{ tag: string; id?: string; classes: string[] }>;
  source?: { file: string; line?: number; column?: number };
  url: string;
};

export type PickerMessage =
  | { src: "anyspace"; type: "picker:start" }
  | { src: "anyspace"; type: "picker:stop" }
  | { src: "anyspace"; type: "picker:selected"; payload: ElementCapture }
  | { src: "anyspace"; type: "picker:cancelled" };

function describeParent(p: ElementCapture["parents"][number]): string {
  let s = p.tag;
  if (p.id) s += `#${p.id}`;
  if (p.classes.length) s += "." + p.classes.slice(0, 3).join(".");
  return s;
}

export function shortLabel(c: ElementCapture): string {
  let s = c.tag;
  if (c.id) s += `#${c.id}`;
  if (c.classes.length) s += "." + c.classes.slice(0, 3).join(".");
  return s;
}

export function renderTaskBody(c: ElementCapture, description: string): string {
  const lines: string[] = [];
  lines.push("## Task");
  lines.push(description.trim() || "(no description)");
  lines.push("");
  lines.push("## Element clicked");
  lines.push(`- **Selector:** \`${c.selector}\``);
  lines.push(`- **Tag:** \`<${c.tag}>\``);
  lines.push(`- **Page URL:** ${c.url}`);
  lines.push(`- **Bounding box:** ${c.rect.x},${c.rect.y} ${c.rect.w}×${c.rect.h}`);
  if (c.source) {
    const loc = [c.source.file, c.source.line, c.source.column]
      .filter((v) => v !== undefined && v !== null)
      .join(":");
    lines.push(`- **Source:** ${loc}`);
  }
  if (c.textPreview) {
    lines.push(`- **Text:** ${c.textPreview}`);
  }

  const attrEntries = Object.entries(c.attributes);
  if (attrEntries.length) {
    lines.push("");
    lines.push("### Attributes");
    for (const [k, v] of attrEntries) lines.push(`- \`${k}\`: \`${v}\``);
  }

  if (c.parents.length) {
    lines.push("");
    lines.push("### Parent chain (outermost → innermost)");
    for (const p of c.parents) lines.push(`- \`${describeParent(p)}\``);
  }

  lines.push("");
  lines.push("### outerHTML (truncated)");
  lines.push("```html");
  lines.push(c.outerHTML);
  lines.push("```");
  return lines.join("\n");
}
