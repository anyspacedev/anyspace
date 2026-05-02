import { aiChat } from "./tauri";
import { useAiStore } from "../stores/aiStore";
import { useKanbanStore } from "../stores/kanbanStore";
import { BUILTIN_ROLES, type TeamRole } from "./teamRoles";
import { BUILTIN_SKILLS } from "./teamSkills";

export type DecomposedRosterRow = {
  role: TeamRole;
  label: string;
  /** Hint about which AI program (Claude / Codex / etc.) suits this role. */
  programHint?: string;
};

export type Decomposed = {
  teamName: string;
  roster: DecomposedRosterRow[];
  skillIds: string[];
  notes?: string;
};

const SYSTEM_PROMPT = `You are a software-team architect. Given a goal in plain English plus the available roles, skills, and AI programs, decide how a small multi-agent team should be staffed.

OUTPUT FORMAT (strict): a single JSON object — no markdown fences, no preamble, no trailing text.
{
  "teamName": string (4-40 chars),
  "roster": [
    { "role": "coordinator" | "builder" | "scout" | "reviewer", "label": string, "programHint": string }
  ],
  "skillIds": string[],
  "notes": string (optional, 1-2 sentences)
}

CONSTRAINTS:
- 1 coordinator, 0-1 scout, 1-4 builders, 0-1 reviewer.
- Total agents 3-6.
- Labels are unique per team — number duplicates ("Builder 1", "Builder 2").
- Use ONLY skill ids from the provided list.
- programHint is one of the provided agent program names.
- Pick skills that are relevant to the goal — fewer, sharper picks beat exhaustive lists.
- Output the JSON object alone. Any extra text breaks the consumer.`;

export async function decomposeWithAi(input: {
  goal: string;
  projectPath: string;
  defaultName: string;
}): Promise<Decomposed> {
  const ai = useAiStore.getState().settings;
  if (!ai.endpoint || !ai.apiKey || !ai.model) {
    throw new Error(
      "AI is not configured — set endpoint / API key / model in Settings → AI before using decomposition.",
    );
  }
  const goal = input.goal.trim();
  if (!goal) throw new Error("Add a goal first — the AI needs something to decompose.");

  const programs = useKanbanStore.getState().agents.map((a) => a.name);
  const skillCatalog = BUILTIN_SKILLS.map((s) => ({ id: s.id, label: s.label, body: s.body }));

  const userMessage = JSON.stringify(
    {
      goal,
      projectPath: input.projectPath,
      defaultTeamName: input.defaultName,
      availableRoles: BUILTIN_ROLES,
      availablePrograms: programs,
      availableSkills: skillCatalog,
    },
    null,
    2,
  );

  const reply = await aiChat({
    endpoint: ai.endpoint,
    apiKey: ai.apiKey,
    model: ai.model,
    systemPrompt: SYSTEM_PROMPT,
    userMessage,
  });

  return parseDecomposed(reply);
}

function parseDecomposed(reply: string): Decomposed {
  // Strip leading/trailing fences if the model ignored the no-fence rule.
  let s = reply.trim();
  s = s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  // Find the outermost {...} so we tolerate one or two stray sentences.
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`AI response was not JSON: ${reply.slice(0, 120)}`);
  }
  const json = s.slice(start, end + 1);
  let obj: unknown;
  try {
    obj = JSON.parse(json);
  } catch (err) {
    throw new Error(`AI response was not valid JSON: ${err instanceof Error ? err.message : err}`);
  }
  if (!obj || typeof obj !== "object") throw new Error("AI response was not an object");
  const o = obj as Record<string, unknown>;

  const teamName = typeof o.teamName === "string" && o.teamName.trim() ? o.teamName.trim() : "Team";
  const rosterRaw = Array.isArray(o.roster) ? o.roster : [];
  const roster: DecomposedRosterRow[] = [];
  for (const row of rosterRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const role = typeof r.role === "string" ? r.role : "";
    const label = typeof r.label === "string" ? r.label.trim() : "";
    if (!role || !label) continue;
    if (!(BUILTIN_ROLES as readonly string[]).includes(role)) continue;
    const programHint = typeof r.programHint === "string" ? r.programHint : undefined;
    roster.push({ role: role as TeamRole, label, programHint });
  }
  if (roster.length === 0) throw new Error("AI returned an empty roster");

  const skillIdsRaw = Array.isArray(o.skillIds) ? o.skillIds : [];
  const validSkills = new Set(BUILTIN_SKILLS.map((s) => s.id));
  const skillIds = skillIdsRaw.filter(
    (x): x is string => typeof x === "string" && validSkills.has(x),
  );
  const notes = typeof o.notes === "string" ? o.notes : undefined;

  return { teamName, roster, skillIds, notes };
}
