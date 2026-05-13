/**
 * Central registry of every customizable prompt the app sends to AI models.
 *
 * The default text for each prompt lives in its source module (e.g.
 * `SUPER_BRAIN_SYSTEM_PROMPT_DEFAULT` in `superBrain.ts`) so changing the
 * default in one place updates both the live runtime and the Settings UI.
 *
 * The Rust-side `AGENT_API_HINT` default is mirrored here as a string literal
 * so the Settings textarea can display its default; the source of truth at
 * runtime is still `src-tauri/src/agent/launcher.rs::AGENT_API_HINT`.
 *
 * Use `getPrompt(id)` everywhere a prompt is read — it returns the user's
 * override (if any) and falls back to the compiled-in default.
 */

import type { PromptId } from "./promptOverrides";
import { SUPER_BRAIN_SYSTEM_PROMPT_DEFAULT } from "./superBrain";
import { AI_SUGGEST_SUPER_AGENT_PROMPT_DEFAULT } from "./aiSuggest/superAgentPrompt";
import { AI_SUGGEST_TEMPLATE_SETUP_PROMPT_DEFAULT } from "./aiSuggest/templateSetup";
import { AI_SUGGEST_TEAM_DECOMPOSE_PROMPT_DEFAULT } from "./aiSuggest/teamDecompose";
import { AI_SUGGEST_KANBAN_TASK_PROMPT_DEFAULT } from "./aiSuggest/kanbanTask";
import { SUPER_AGENT_AUTO_NAME_PROMPT_DEFAULT } from "./superAgent/autoName";
import { SUPER_AGENT_BACKGROUND_SUFFIX_DEFAULT } from "./superAgent/agent";
import {
  TEAM_COMMON_RULES_DEFAULT,
  TEAM_COORDINATOR_PROMPT_DEFAULT,
  TEAM_BUILDER_PROMPT_DEFAULT,
  TEAM_SCOUT_PROMPT_DEFAULT,
  TEAM_REVIEWER_PROMPT_DEFAULT,
  TEAM_CUSTOM_PROMPT_DEFAULT,
} from "./teamRoles";
import { OPERATOR_INBOX_HANDOFF_DEFAULT } from "./operatorInboxHandoff";

export type { PromptId } from "./promptOverrides";

export type PromptGroupId =
  | "super-brain"
  | "ai-suggest"
  | "super-agent"
  | "team"
  | "operator"
  | "agent-launch";

export type PromptKind = "prose" | "structured";

export type PromptMeta = {
  label: string;
  description: string;
  group: PromptGroupId;
  /** Approximate visible row count for the textarea. */
  rows: number;
  /** "structured" prompts use monospace and contain ${...} tokens. */
  kind: PromptKind;
  /** ${TOKENS} substituted into the final prompt at runtime. */
  placeholders?: { token: string; explain: string }[];
};

/**
 * Default text for `AGENT_API_HINT` is duplicated from
 * `src-tauri/src/agent/launcher.rs::AGENT_API_HINT`. Keep in sync if the Rust
 * constant changes — Rust remains the runtime source of truth.
 */
const AGENT_API_HINT_DEFAULT = `## Code Agent Preview API

A loopback HTTP server lets you drive the live preview pane and capture
screenshots without operator clicks. These env vars are set automatically
when running inside AnySpace:

- \`$ANYSPACE_API_URL\`   — base URL (e.g. http://127.0.0.1:NNNN)
- \`$ANYSPACE_API_TOKEN\` — bearer token, send as \`Authorization: Bearer <token>\`
- \`$ANYSPACE_PANE_ID\`   — your own pane id, send as \`X-Pane-Id: <pane-id>\`

If \`$ANYSPACE_API_URL\` is unset, the API is unavailable and you should
fall back to operator-assisted workflows.

### Common operations

Open / refocus the live preview alongside this terminal:

\`\`\`sh
curl -sX POST \\
  -H "Authorization: Bearer $ANYSPACE_API_TOKEN" \\
  -H "X-Pane-Id: $ANYSPACE_PANE_ID" \\
  -H "content-type: application/json" \\
  -d "{\\"projectPath\\":\\"$PWD\\"}" \\
  "$ANYSPACE_API_URL/v1/preview/open"
\`\`\`

Screenshot the preview after making UI changes; the response's \`path\`
points at a PNG you can feed to your own image-Read tool to inspect:

\`\`\`sh
curl -sX POST \\
  -H "Authorization: Bearer $ANYSPACE_API_TOKEN" \\
  -H "X-Pane-Id: $ANYSPACE_PANE_ID" \\
  -H "content-type: application/json" \\
  -d '{}' \\
  "$ANYSPACE_API_URL/v1/preview/screenshot"
\`\`\`

Drive the preview programmatically (same auth headers):

\`\`\`
POST /v1/preview/click     {"selector":"button.submit"}
POST /v1/preview/fill      {"selector":"input[name=email]","value":"x@y.z","submit":true}
POST /v1/preview/navigate  {"url":"http://localhost:5173/about"}
GET  /v1/preview/detect?projectPath=$PWD
GET  /v1/panes
\`\`\`

Recommended loop after editing UI source: edit → wait for HMR → screenshot
→ Read the screenshot path → reason about the result → iterate.
`;

export const DEFAULT_PROMPTS: Record<PromptId, string> = {
  superBrain: SUPER_BRAIN_SYSTEM_PROMPT_DEFAULT,
  aiSuggestSuperAgent: AI_SUGGEST_SUPER_AGENT_PROMPT_DEFAULT,
  aiSuggestTemplateSetup: AI_SUGGEST_TEMPLATE_SETUP_PROMPT_DEFAULT,
  aiSuggestTeamDecompose: AI_SUGGEST_TEAM_DECOMPOSE_PROMPT_DEFAULT,
  aiSuggestKanbanTask: AI_SUGGEST_KANBAN_TASK_PROMPT_DEFAULT,
  superAgentAutoName: SUPER_AGENT_AUTO_NAME_PROMPT_DEFAULT,
  superAgentBackgroundSuffix: SUPER_AGENT_BACKGROUND_SUFFIX_DEFAULT,
  teamCommonRules: TEAM_COMMON_RULES_DEFAULT,
  teamCoordinator: TEAM_COORDINATOR_PROMPT_DEFAULT,
  teamBuilder: TEAM_BUILDER_PROMPT_DEFAULT,
  teamScout: TEAM_SCOUT_PROMPT_DEFAULT,
  teamReviewer: TEAM_REVIEWER_PROMPT_DEFAULT,
  teamCustom: TEAM_CUSTOM_PROMPT_DEFAULT,
  operatorInboxHandoff: OPERATOR_INBOX_HANDOFF_DEFAULT,
  agentApiHint: AGENT_API_HINT_DEFAULT,
};

const BOARD_PATH = {
  token: "${BOARD_PATH}",
  explain: "Absolute path to the team's BOARD.md file.",
};
const MESSAGES_PATH = {
  token: "${MESSAGES_PATH}",
  explain: "Absolute path to the team's MESSAGES.md file.",
};

export const PROMPT_METADATA: Record<PromptId, PromptMeta> = {
  superBrain: {
    label: "Super Brain (⌘⇧B)",
    description:
      "System prompt for the next-command suggester. The model sees the user's last command + output and must reply with one shell-runnable line.",
    group: "super-brain",
    rows: 5,
    kind: "prose",
  },
  aiSuggestSuperAgent: {
    label: "Suggest Super Agent first message",
    description:
      "Drafts the seed user message when starting a new Super Agent chat from the active pane.",
    group: "ai-suggest",
    rows: 10,
    kind: "structured",
  },
  aiSuggestTemplateSetup: {
    label: "Suggest workspace setup",
    description:
      "Picks a multi-pane workspace template + slot assignment from a one-line goal.",
    group: "ai-suggest",
    rows: 10,
    kind: "structured",
  },
  aiSuggestTeamDecompose: {
    label: "AI-assisted team staffing",
    description:
      "Decomposes a goal into a roster (coordinator + builders + optional scout/reviewer) and picks relevant skills.",
    group: "ai-suggest",
    rows: 10,
    kind: "structured",
  },
  aiSuggestKanbanTask: {
    label: "Expand kanban titles",
    description:
      "Turns a one-line kanban task title into a body with acceptance criteria and picks the best agent for it.",
    group: "ai-suggest",
    rows: 10,
    kind: "structured",
  },
  superAgentAutoName: {
    label: "Auto-name Super Agent sessions",
    description:
      "One-shot title generator after the first user → assistant exchange. Replies with the title alone.",
    group: "super-agent",
    rows: 5,
    kind: "prose",
  },
  superAgentBackgroundSuffix: {
    label: "Background-watcher suffix",
    description:
      "Appended to the main Super Agent system prompt when the background watcher is running. Steers the model into observe-and-propose mode.",
    group: "super-agent",
    rows: 8,
    kind: "prose",
  },
  teamCommonRules: {
    label: "Team rules (all roles)",
    description:
      "Universal rules appended to every team-agent prompt: how tmsg works, polling loop, board updates, escalation patterns.",
    group: "team",
    rows: 16,
    kind: "structured",
    placeholders: [BOARD_PATH],
  },
  teamCoordinator: {
    label: "Coordinator role",
    description:
      "System prompt for the Coordinator — the staff engineer that decomposes the goal, assigns tasks, and verifies completion.",
    group: "team",
    rows: 16,
    kind: "structured",
    placeholders: [BOARD_PATH, MESSAGES_PATH],
  },
  teamBuilder: {
    label: "Builder role",
    description:
      "System prompt for Builders — senior engineers that implement assigned tasks within their owned files.",
    group: "team",
    rows: 16,
    kind: "structured",
    placeholders: [BOARD_PATH, MESSAGES_PATH],
  },
  teamScout: {
    label: "Scout role",
    description:
      "System prompt for the optional Scout — explores the codebase up-front and reports back to the Coordinator.",
    group: "team",
    rows: 16,
    kind: "structured",
    placeholders: [BOARD_PATH, MESSAGES_PATH],
  },
  teamReviewer: {
    label: "Reviewer role",
    description:
      "System prompt for the optional Reviewer — principal engineer reviewing completed tasks against acceptance criteria.",
    group: "team",
    rows: 16,
    kind: "structured",
    placeholders: [BOARD_PATH, MESSAGES_PATH],
  },
  teamCustom: {
    label: "Custom role (fallback)",
    description:
      "Used when a custom role has no body of its own. Users typically define per-role bodies in Settings → Multi-agent teams.",
    group: "team",
    rows: 8,
    kind: "structured",
    placeholders: [BOARD_PATH],
  },
  operatorInboxHandoff: {
    label: "Operator-inbox handoff note",
    description:
      "Wrapper for the system note dropped into Super Agent when the @operator badge is clicked. ${LINES} contains the formatted pings.",
    group: "operator",
    rows: 5,
    kind: "structured",
    placeholders: [
      { token: "${COUNT}", explain: "Number of unread operator messages." },
      { token: "${PLURAL}", explain: "Empty when count is 1, otherwise 's'." },
      { token: "${LINES}", explain: "Formatted block of all unread pings." },
    ],
  },
  agentApiHint: {
    label: "Agent-launch preview-API hint",
    description:
      "Appended to every agent_launch task file (kanban Run Task, team agent prompts). Documents the loopback HTTP API for screenshotting the preview and driving DOM interactions. The task-file scaffold around it is fixed.",
    group: "agent-launch",
    rows: 16,
    kind: "structured",
  },
};

export type PromptGroup = {
  id: PromptGroupId;
  label: string;
  description?: string;
  promptIds: PromptId[];
};

export const PROMPT_GROUPS: PromptGroup[] = [
  {
    id: "super-brain",
    label: "Super Brain",
    description: "The ⌘⇧B next-command suggester.",
    promptIds: ["superBrain"],
  },
  {
    id: "ai-suggest",
    label: "AI suggestions",
    description:
      "Small one-shot prompts used by the ✨ sparkle buttons across the app.",
    promptIds: [
      "aiSuggestSuperAgent",
      "aiSuggestTemplateSetup",
      "aiSuggestTeamDecompose",
      "aiSuggestKanbanTask",
    ],
  },
  {
    id: "super-agent",
    label: "Super Agent",
    description:
      "Session-naming and background-watcher steering. The main Super Agent system prompt lives in its own section above.",
    promptIds: ["superAgentAutoName", "superAgentBackgroundSuffix"],
  },
  {
    id: "team",
    label: "Team roles",
    description:
      "Built-in role bodies and the universal rules block included with every team agent. Custom roles can be defined under Multi-agent teams.",
    promptIds: [
      "teamCommonRules",
      "teamCoordinator",
      "teamBuilder",
      "teamScout",
      "teamReviewer",
      "teamCustom",
    ],
  },
  {
    id: "operator",
    label: "Operator handoff",
    description:
      "The system note that hands off unread @operator messages into Super Agent when you click the inbox badge.",
    promptIds: ["operatorInboxHandoff"],
  },
  {
    id: "agent-launch",
    label: "Agent launch",
    description:
      "The preview-API hint appended to every agent task file. The surrounding task-file scaffold is fixed and not customizable.",
    promptIds: ["agentApiHint"],
  },
];

/** Whether the user has stored an override for this prompt (including empty string). */
export function isPromptOverridden(id: PromptId, overrides: Partial<Record<PromptId, string>>): boolean {
  return Object.prototype.hasOwnProperty.call(overrides, id);
}

/** Helper for the sub-group summary badge. */
export function customizedCount(groupId: PromptGroupId, overrides: Partial<Record<PromptId, string>>): {
  custom: number;
  total: number;
} {
  const group = PROMPT_GROUPS.find((g) => g.id === groupId);
  if (!group) return { custom: 0, total: 0 };
  const total = group.promptIds.length;
  const custom = group.promptIds.filter((id) => isPromptOverridden(id, overrides)).length;
  return { custom, total };
}
