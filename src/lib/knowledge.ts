import { invoke as rawInvoke } from "@tauri-apps/api/core";

// Typed wrappers for the project-local knowledge layer.
//
// Notes live under <projectPath>/.anyspace/knowledge/ as one .md file per note.
// Frontmatter (title, created, updated, tags) is plain markdown YAML-ish parsed
// by the Rust side — frontend treats notes as opaque {title, body, tags}.

export type NoteSummary = {
  slug: string;
  title: string;
  created: number;
  updated: number;
  tags: string[];
  preview: string;
  backlinkCount: number;
};

export type RefLink = {
  targetSlug: string | null;
  targetTitle: string;
  resolved: boolean;
  context: string;
};

export type BacklinkRef = {
  sourceSlug: string;
  sourceTitle: string;
  context: string;
};

export type Note = {
  slug: string;
  title: string;
  body: string;
  created: number;
  updated: number;
  tags: string[];
  backlinks: BacklinkRef[];
  outbound: RefLink[];
};

export type KnowledgeNode = {
  slug: string;
  title: string;
  backlinkCount: number;
};

export type KnowledgeEdge = {
  source: string;
  target: string;
};

export type KnowledgeGraph = {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
};

export async function knowledgeInit(projectPath: string): Promise<void> {
  return rawInvoke("knowledge_init", { args: { projectPath } });
}

export async function knowledgeList(projectPath: string): Promise<NoteSummary[]> {
  return rawInvoke<NoteSummary[]>("knowledge_list", { args: { projectPath } });
}

export async function knowledgeRead(projectPath: string, slug: string): Promise<Note> {
  return rawInvoke<Note>("knowledge_read", { args: { projectPath, slug } });
}

export type KnowledgeWriteArgs = {
  projectPath: string;
  title: string;
  body: string;
  slug?: string;
  tags?: string[];
};

export async function knowledgeWrite(args: KnowledgeWriteArgs): Promise<Note> {
  return rawInvoke<Note>("knowledge_write", { args });
}

export async function knowledgeDelete(projectPath: string, slug: string): Promise<void> {
  return rawInvoke("knowledge_delete", { args: { projectPath, slug } });
}

export async function knowledgeSearch(
  projectPath: string,
  query: string,
  limit?: number,
): Promise<NoteSummary[]> {
  return rawInvoke<NoteSummary[]>("knowledge_search", {
    args: { projectPath, query, limit },
  });
}

export async function knowledgeGraph(projectPath: string): Promise<KnowledgeGraph> {
  return rawInvoke<KnowledgeGraph>("knowledge_graph", { args: { projectPath } });
}

export async function knowledgeWatchStart(projectPath: string): Promise<void> {
  return rawInvoke("knowledge_watch_start", { args: { projectPath } });
}

export async function knowledgeWatchStop(projectPath: string): Promise<void> {
  return rawInvoke("knowledge_watch_stop", { args: { projectPath } });
}

export async function knowledgeProjectHash(projectPath: string): Promise<string> {
  return rawInvoke<string>("knowledge_project_hash", { projectPath });
}

/** Slugify a title the same way the Rust side does, for client-side preview
 *  before the round-trip. Keep in sync with `slugify` in commands.rs. */
export function slugify(s: string): string {
  let out = "";
  let lastDash = true;
  for (const ch of s.toLowerCase()) {
    if (/[a-z0-9]/.test(ch)) {
      out += ch;
      lastDash = false;
    } else if (!lastDash) {
      out += "-";
      lastDash = true;
    }
  }
  while (out.endsWith("-")) out = out.slice(0, -1);
  return out || "untitled";
}
