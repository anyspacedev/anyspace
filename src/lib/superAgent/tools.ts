// Super Agent tool registry. Each tool exposes a JSON-schema parameter shape
// (sent to the model as OpenAI function-calling tools[] entries) and a handler
// the runner calls with the model's parsed arguments. Trust mode: write tools
// run without an approval modal but render an inline tool-call card with
// args, status, and result preview.
//
// Adding a new tool: add an entry to TOOLS, set readOnly accordingly, and
// implement the handler. The runner picks up the new tool automatically and
// surfaces an enable/disable toggle in Settings.

import { readTextFile } from "@tauri-apps/plugin-fs";
import {
  fsListDirRecursive,
  gitStatus,
  previewDetect,
  ptyWrite,
  type AiToolDef,
} from "../tauri";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useTeamStore } from "../../stores/teamStore";
import { useTeamSettingsStore } from "../../stores/teamSettingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { getTerminalContext } from "../../components/terminal/terminalRegistry";
import { launchTeam } from "../teamLauncher";
import { runQuickSuggest } from "../superBrain";
import type { TeamRole } from "../teamRoles";

export type ToolName =
  | "list_panes"
  | "read_pane_output"
  | "list_dir"
  | "read_file"
  | "git_status"
  | "preview_detect"
  | "list_kanban_tasks"
  | "list_agents"
  | "list_teams"
  | "write_pane"
  | "new_terminal_pane"
  | "close_pane"
  | "create_kanban_task"
  | "tmsg_send"
  | "launch_team"
  | "quick_suggest";

export type ToolHandlerResult = {
  /** JSON-stringified content the model sees as the tool result. */
  resultText: string;
};

export type Tool = {
  name: ToolName;
  description: string;
  /** Read-only tools never mutate state; write tools may. Display-only flag —
   *  enforcement is at runtime via Settings.toolEnabled. */
  readOnly: boolean;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<ToolHandlerResult>;
};

function ok(payload: unknown): ToolHandlerResult {
  return { resultText: typeof payload === "string" ? payload : JSON.stringify(payload, null, 2) };
}

function bad(message: string): ToolHandlerResult {
  return { resultText: JSON.stringify({ error: message }) };
}

function arg<T>(args: Record<string, unknown>, key: string): T | undefined {
  return args[key] as T | undefined;
}

export const TOOLS: Tool[] = [
  {
    name: "list_panes",
    description:
      "List every workspace tab and its panes (kind, title, paneId). Use this before any tool that takes a paneId.",
    readOnly: true,
    parameters: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const ws = useWorkspaceStore.getState();
      return ok(
        ws.tabs.map((t) => ({
          tabId: t.id,
          name: t.name,
          activePaneId: t.activePaneId,
          panes: Object.values(t.panes).map((p) => ({
            paneId: p.id,
            kind: p.kind,
            title: (p.payload as Record<string, unknown> | undefined)?.title ?? null,
          })),
        })),
      );
    },
  },
  {
    name: "read_pane_output",
    description:
      "Return the most recent finished command + its output for a terminal pane. Returns null if the pane has no completed command yet.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "Pane id from list_panes" },
        last_n: {
          type: "integer",
          description: "Tail this many lines of output (default: full)",
          minimum: 1,
        },
      },
      required: ["pane_id"],
    },
    handler: async (args) => {
      const paneId = arg<string>(args, "pane_id");
      if (!paneId) return bad("missing pane_id");
      const ctx = getTerminalContext(paneId);
      if (!ctx) return ok(null);
      const lastN = arg<number>(args, "last_n");
      const output = lastN
        ? ctx.output.split(/\r?\n/).slice(-lastN).join("\n")
        : ctx.output;
      return ok({ command: ctx.command, exitCode: ctx.exitCode ?? null, output });
    },
  },
  {
    name: "list_dir",
    description:
      "Recursively list a directory (excludes node_modules, .git, target, dist, etc.). Returns up to 5000 entries.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute directory path" },
        max_depth: { type: "integer", minimum: 1, description: "Default 4" },
      },
      required: ["path"],
    },
    handler: async (args) => {
      const path = arg<string>(args, "path");
      if (!path) return bad("missing path");
      const maxDepth = arg<number>(args, "max_depth") ?? 4;
      try {
        const entries = await fsListDirRecursive(path, maxDepth);
        return ok(entries);
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "read_file",
    description:
      "Read a UTF-8 text file and return its contents. Path must fall under the configured fs:scope (typically $HOME/**).",
    readOnly: true,
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Absolute file path" } },
      required: ["path"],
    },
    handler: async (args) => {
      const path = arg<string>(args, "path");
      if (!path) return bad("missing path");
      try {
        const content = await readTextFile(path);
        return ok({ path, content });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "git_status",
    description:
      "Run `git status --porcelain` in a directory and return a path→status-letter map. Empty map for non-git dirs.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Absolute dir; defaults to active tab's projectPath" },
      },
      required: [],
    },
    handler: async (args) => {
      let dir = arg<string>(args, "dir");
      if (!dir) {
        const ws = useWorkspaceStore.getState();
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        dir = tab?.projectPath;
      }
      if (!dir) return bad("no dir specified and no active tab projectPath");
      try {
        const status = await gitStatus(dir);
        return ok({ dir, files: status });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "preview_detect",
    description:
      "Detect a frontend dev-server framework + URL for a project (looks at package.json, common ports).",
    readOnly: true,
    parameters: {
      type: "object",
      properties: { project_path: { type: "string" } },
      required: ["project_path"],
    },
    handler: async (args) => {
      const path = arg<string>(args, "project_path");
      if (!path) return bad("missing project_path");
      try {
        const detected = await previewDetect(path);
        return ok(detected);
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "list_kanban_tasks",
    description: "List all kanban tasks with their column and assigned agent.",
    readOnly: true,
    parameters: { type: "object", properties: {}, required: [] },
    handler: async () => ok(useKanbanStore.getState().tasks),
  },
  {
    name: "list_agents",
    description: "List configured AI agent programs (name, command template).",
    readOnly: true,
    parameters: { type: "object", properties: {}, required: [] },
    handler: async () =>
      ok(
        useKanbanStore.getState().agents.map((a) => ({
          id: a.id,
          name: a.name,
          command: a.command,
        })),
      ),
  },
  {
    name: "list_teams",
    description: "List teams with status, project path, goal, and agent count.",
    readOnly: true,
    parameters: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const ts = useTeamStore.getState();
      return ok(
        ts.teams.map((t) => ({
          id: t.id,
          name: t.name,
          status: t.status,
          projectPath: t.projectPath,
          goal: t.goal,
          tabId: t.tabId,
          agentCount: (ts.agents[t.id] ?? []).length,
        })),
      );
    },
  },
  {
    name: "write_pane",
    description:
      "Write text to a terminal pane's PTY. submit=true appends a newline (executes the command); submit=false leaves the bytes at the prompt for the operator to review.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        pane_id: { type: "string" },
        text: { type: "string" },
        submit: { type: "boolean", description: "Append \\n to execute. Default false." },
      },
      required: ["pane_id", "text"],
    },
    handler: async (args) => {
      const paneId = arg<string>(args, "pane_id");
      const text = arg<string>(args, "text");
      const submit = arg<boolean>(args, "submit") ?? false;
      if (!paneId) return bad("missing pane_id");
      if (text == null) return bad("missing text");
      const ctx = getTerminalContext(paneId);
      if (!ctx) return bad(`pane ${paneId} has no live PTY session`);
      const payload = submit ? `${text}\n` : text;
      try {
        await ptyWrite(ctx.sessionId, new TextEncoder().encode(payload));
        return ok({ wroteBytes: payload.length, submitted: submit });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "new_terminal_pane",
    description:
      "Open a new workspace tab with a single terminal. Optionally specify a command to auto-run after the shell starts.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        cmd: { type: "string", description: "Optional pendingCommand to execute on spawn" },
        cwd: { type: "string", description: "Working directory" },
        title: { type: "string", description: "Tab + pane title" },
      },
      required: [],
    },
    handler: async (args) => {
      const cmd = arg<string>(args, "cmd");
      const cwd = arg<string>(args, "cwd");
      const title = arg<string>(args, "title") ?? cmd ?? "Terminal";
      const tabId = useWorkspaceStore
        .getState()
        .newTab(1, title, [
          {
            kind: "terminal",
            pendingCommand: cmd,
            spawnCwd: cwd,
            title,
          },
        ], cwd);
      return ok({ tabId });
    },
  },
  {
    name: "close_pane",
    description: "Close a single pane by id.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: { pane_id: { type: "string" } },
      required: ["pane_id"],
    },
    handler: async (args) => {
      const paneId = arg<string>(args, "pane_id");
      if (!paneId) return bad("missing pane_id");
      const ws = useWorkspaceStore.getState();
      const tab = ws.tabs.find((t) =>
        Object.prototype.hasOwnProperty.call(t.panes, paneId),
      );
      if (!tab) return bad(`pane ${paneId} not found`);
      ws.closePane(tab.id, paneId);
      return ok({ closed: paneId, tabId: tab.id });
    },
  },
  {
    name: "create_kanban_task",
    description: "Add a task to the kanban board.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        agent_id: { type: "string", description: "Agent program id (from list_agents)" },
        column: {
          type: "string",
          enum: ["todo", "in_progress", "in_review", "complete"],
        },
        project_path: { type: "string" },
      },
      required: ["title"],
    },
    handler: async (args) => {
      const title = arg<string>(args, "title");
      if (!title) return bad("missing title");
      try {
        const task = await useKanbanStore.getState().createTask({
          title,
          body: arg<string>(args, "body") ?? "",
          agentId: arg<string>(args, "agent_id"),
          column: (arg<string>(args, "column") as
            | "todo"
            | "in_progress"
            | "in_review"
            | "complete"
            | undefined) ?? "todo",
          projectPath: arg<string>(args, "project_path"),
        });
        return ok(task);
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "tmsg_send",
    description:
      "Send a message into a team's MESSAGES.md log. Recipients can be a team-agent label, @all, or @operator.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        to: { type: "string", description: "Label, @all, or @operator" },
        body: { type: "string" },
        type: {
          type: "string",
          enum: ["message", "status", "escalation", "done"],
          description: "Default: message",
        },
        from: {
          type: "string",
          description: "Sender label; defaults to 'Super Agent'",
        },
      },
      required: ["team_id", "to", "body"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const to = arg<string>(args, "to");
      const body = arg<string>(args, "body");
      const type = arg<string>(args, "type") ?? "message";
      const from = arg<string>(args, "from") ?? "Super Agent";
      if (!teamId || !to || !body) return bad("missing team_id / to / body");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      const id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2);
      const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
      const block = `\n<!-- msg id="${id}" from="${from.replace(/"/g, '\\"')}" to="${to.replace(/"/g, '\\"')}" type="${type}" ts="${ts}" -->\n${body}\n<!-- /msg -->\n`;
      try {
        const { readTextFile: rtf, writeTextFile } = await import("@tauri-apps/plugin-fs");
        const path = `${team.teamDir}/MESSAGES.md`;
        let prev = "";
        try {
          prev = await rtf(path);
        } catch {
          /* file may not exist yet — team_init creates it on launch */
        }
        await writeTextFile(path, prev + block);
        return ok({ id, ts, teamId, to });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "launch_team",
    description:
      "Create and launch a Team workspace. roster is an array of {role, label, agent_id} entries.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        project_path: { type: "string" },
        goal: { type: "string" },
        roster: {
          type: "array",
          items: {
            type: "object",
            properties: {
              role: { type: "string" },
              label: { type: "string" },
              agent_id: { type: "string" },
            },
            required: ["role", "label", "agent_id"],
          },
        },
        skill_ids: { type: "array", items: { type: "string" } },
      },
      required: ["name", "project_path", "goal", "roster"],
    },
    handler: async (args) => {
      const name = arg<string>(args, "name");
      const projectPath = arg<string>(args, "project_path");
      const goal = arg<string>(args, "goal") ?? "";
      const rosterIn = arg<Array<{ role: string; label: string; agent_id: string }>>(
        args,
        "roster",
      );
      const skillIds = arg<string[]>(args, "skill_ids") ?? [];
      if (!name || !projectPath || !rosterIn || rosterIn.length === 0) {
        return bad("missing name / project_path / roster");
      }
      try {
        const { team } = await useTeamStore.getState().create({
          name,
          projectPath,
          goal,
          agents: rosterIn.map((r) => ({
            label: r.label,
            role: r.role as TeamRole,
            agentId: r.agent_id,
          })),
          skillIds,
          attachments: [],
        });
        const settings = useTeamSettingsStore.getState().settings;
        const result = await launchTeam(team.id, {
          customSkills: settings.customSkills,
          customRoles: settings.customRoles,
        });
        return ok({ teamId: team.id, tabId: result?.tabId, paneIdsByLabel: result?.paneIdsByLabel });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "quick_suggest",
    description:
      "Capture the latest finished command + output from a terminal pane and propose the next shell command. Returns the suggestion as text — call write_pane separately if you want to apply it.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: { pane_id: { type: "string" } },
      required: ["pane_id"],
    },
    handler: async (args) => {
      const paneId = arg<string>(args, "pane_id");
      if (!paneId) return bad("missing pane_id");
      try {
        const text = await runQuickSuggest({ paneId, write: false });
        return ok({ pane_id: paneId, suggestion: text });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
];

export function findTool(name: string): Tool | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** Build the OpenAI `tools: [...]` payload, skipping disabled tools so the
 *  model never sees options the operator turned off. */
export function buildToolsPayload(
  enabledTools: Set<ToolName>,
): AiToolDef[] {
  return TOOLS.filter((t) => enabledTools.has(t.name)).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}
