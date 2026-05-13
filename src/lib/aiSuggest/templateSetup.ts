import { runAiSuggest } from "./runner";
import type { KanbanAgentLite } from "./kanbanTask";
import { getPrompt } from "../prompts";

export type TemplateLite = {
  id: number;
  label: string;
  panes: number;
};

/** Slots accept the same string-encoded values that TemplatePicker writes
 *  into `paneAssign`: "preview", "editor", "files", "agent:<agentId>", or
 *  "" for plain shell. */
export type SuggestedTemplate = {
  templateId: number;
  paneAssign: Record<number, string>;
  notes?: string;
};

export const AI_SUGGEST_TEMPLATE_SETUP_PROMPT_DEFAULT = `You configure a multi-pane workspace from a one-line goal.

OUTPUT FORMAT (strict): a single JSON object — no markdown fences, no preamble, no trailing text.
{
  "templateId": number (one of the provided template ids),
  "paneAssign": {
    "<paneIndex>": "" | "preview" | "editor" | "files" | "agent:<agentId>"
  },
  "notes": string (optional, 1 sentence rationale)
}

CONSTRAINTS:
- Pick the template whose pane count fits the goal — favour the smallest layout that fits.
- paneAssign keys are STRING indices "0".."panes-1". Cover every pane.
- Slot values:
    "" — plain shell terminal (default for "open a project" or unspecified work)
    "preview" — live preview of a dev server (web/SaaS goals)
    "editor" — code editor pane (when reading/editing a specific file matters)
    "files" — file browser (when navigating a tree matters)
    "agent:<agentId>" — launch the named agent in that pane (use ONLY ids from the agents list)
- Output the JSON object alone. Any extra text breaks the consumer.`;

export async function suggestTemplateSetup(input: {
  goal: string;
  templates: TemplateLite[];
  agents: KanbanAgentLite[];
}): Promise<SuggestedTemplate> {
  const goal = input.goal.trim();
  if (!goal) throw new Error("Type a goal first — the AI needs something to lay out.");

  return runAiSuggest({
    surface: "template-setup",
    systemPrompt: getPrompt("aiSuggestTemplateSetup"),
    context: {
      goal,
      templates: input.templates,
      agents: input.agents.map((a) => ({ id: a.id, name: a.name, command: a.command })),
    },
    parse: (obj) => {
      if (!obj || typeof obj !== "object") throw new Error("AI response was not an object");
      const o = obj as Record<string, unknown>;

      const wantedId = typeof o.templateId === "number" ? o.templateId : null;
      const validIds = new Set(input.templates.map((t) => t.id));
      const templateId = wantedId != null && validIds.has(wantedId)
        ? wantedId
        : input.templates[0]?.id ?? 1;
      const tpl = input.templates.find((t) => t.id === templateId)!;

      const validAgentIds = new Set(input.agents.map((a) => a.id));
      const validKinds = new Set(["", "preview", "editor", "files"]);
      const paneAssignRaw = (o.paneAssign && typeof o.paneAssign === "object")
        ? (o.paneAssign as Record<string, unknown>)
        : {};
      const paneAssign: Record<number, string> = {};
      for (let i = 0; i < tpl.panes; i++) {
        const raw = paneAssignRaw[String(i)];
        const value = typeof raw === "string" ? raw : "";
        if (validKinds.has(value)) {
          paneAssign[i] = value;
        } else if (value.startsWith("agent:") && validAgentIds.has(value.slice("agent:".length))) {
          paneAssign[i] = value;
        } else {
          paneAssign[i] = "";
        }
      }
      const notes = typeof o.notes === "string" ? o.notes : undefined;
      return { templateId, paneAssign, notes };
    },
  });
}
