export type DocSection = {
  id: string;
  label: string;
  blurb: string;
};

export const SECTIONS: readonly DocSection[] = [
  { id: "get-started", label: "Get started", blurb: "Install, first launch, end-to-end tour." },
  { id: "workspace", label: "Workspace basics", blurb: "Tabs, panes, layouts, and how state survives." },
  { id: "day-to-day", label: "Day-to-day work", blurb: "Terminal, editor, preview, mobile, screenshots." },
  { id: "ai", label: "AI workflows", blurb: "Configure providers, Super Brain, Super Agent, voice." },
  { id: "team", label: "Tasks & teams", blurb: "Kanban-driven agents and multi-agent collaboration." },
  { id: "integrations", label: "Integrations", blurb: "Talk to AnySpace from other tools — MCP, external editors." },
  { id: "reference", label: "Reference", blurb: "Shortcuts, settings, privacy, glossary, troubleshooting." },
] as const;

export function sectionLabel(id: string): string {
  return SECTIONS.find((s) => s.id === id)?.label ?? id;
}
