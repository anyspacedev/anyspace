import type { CollectionEntry } from "astro:content";
import { SECTIONS, sectionLabel } from "../content/docs/_meta";

export type DocEntry = CollectionEntry<"docs">;

export type DocGroup = {
  id: string;
  label: string;
  blurb: string;
  items: DocEntry[];
};

export function groupDocs(entries: DocEntry[]): DocGroup[] {
  const sorted = [...entries].sort((a, b) => {
    const ao = a.data.order ?? 100;
    const bo = b.data.order ?? 100;
    if (ao !== bo) return ao - bo;
    return a.data.title.localeCompare(b.data.title);
  });

  const groups: DocGroup[] = SECTIONS.map((s) => ({
    id: s.id,
    label: s.label,
    blurb: s.blurb,
    items: sorted.filter((e) => e.data.section === s.id),
  }));

  // Tail group for entries with an unrecognized section, so nothing silently disappears.
  const known = new Set(SECTIONS.map((s) => s.id));
  const orphans = sorted.filter((e) => !known.has(e.data.section));
  if (orphans.length > 0) {
    groups.push({ id: "_other", label: "Other", blurb: "", items: orphans });
  }

  return groups.filter((g) => g.items.length > 0);
}

export function flattenDocs(groups: DocGroup[]): DocEntry[] {
  return groups.flatMap((g) => g.items);
}

export function findNeighbors(flat: DocEntry[], currentId: string): { prev: DocEntry | null; next: DocEntry | null } {
  const i = flat.findIndex((e) => e.id === currentId);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: i > 0 ? flat[i - 1] : null,
    next: i < flat.length - 1 ? flat[i + 1] : null,
  };
}

export { sectionLabel };
