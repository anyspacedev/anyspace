import { runAiSuggest } from "./runner";
import { getPrompt } from "../promptOverrides";

export type KanbanAgentLite = {
  id: string;
  name: string;
  command?: string;
};

export type SuggestedKanbanTask = {
  body: string;
  agentId?: string;
  /** Optional rationale, 1-2 sentences. */
  notes?: string;
};

export const AI_SUGGEST_KANBAN_TASK_PROMPT_DEFAULT = `You are a senior engineer turning a one-line task title into a concrete unit of work.

OUTPUT FORMAT (strict): a single JSON object — no markdown fences, no preamble, no trailing text.
{
  "body": string (3-8 short sentences or bullet lines describing what to do, acceptance criteria, and any obvious risks),
  "agentId": string | null (one of the provided agent ids whose name/command best fits this kind of work — null if none clearly fit),
  "notes": string (optional, 1 sentence rationale for the agent pick)
}

CONSTRAINTS:
- Use ONLY agent ids from the provided "agents" list. Do not invent ids.
- Keep "body" concrete and actionable. Reference filenames or modules only if the title hints at them.
- Output the JSON object alone. Any extra text breaks the consumer.`;

export async function suggestKanbanTask(input: {
  title: string;
  agents: KanbanAgentLite[];
  /** Optional existing body — if present, the suggester refines instead of replacing. */
  existingBody?: string;
}): Promise<SuggestedKanbanTask> {
  const title = input.title.trim();
  if (!title) throw new Error("Type a title first — the AI needs something to expand.");

  return runAiSuggest({
    surface: "kanban-task",
    systemPrompt: getPrompt("aiSuggestKanbanTask", AI_SUGGEST_KANBAN_TASK_PROMPT_DEFAULT),
    context: {
      title,
      existingBody: input.existingBody?.trim() || undefined,
      agents: input.agents.map((a) => ({ id: a.id, name: a.name, command: a.command })),
    },
    parse: (obj) => {
      if (!obj || typeof obj !== "object") throw new Error("AI response was not an object");
      const o = obj as Record<string, unknown>;
      const body = typeof o.body === "string" ? o.body.trim() : "";
      if (!body) throw new Error("AI returned an empty body");
      const agentIdRaw = typeof o.agentId === "string" ? o.agentId : "";
      const validIds = new Set(input.agents.map((a) => a.id));
      const agentId = validIds.has(agentIdRaw) ? agentIdRaw : undefined;
      const notes = typeof o.notes === "string" ? o.notes : undefined;
      return { body, agentId, notes };
    },
  });
}
