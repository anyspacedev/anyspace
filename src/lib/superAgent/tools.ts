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
  teamWritePrompt,
  type AiToolDef,
} from "../tauri";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useTeamStore } from "../../stores/teamStore";
import { useTeamSettingsStore } from "../../stores/teamSettingsStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useOperatorInboxStore } from "../../stores/operatorInboxStore";
import {
  getTerminalContext,
  getTerminalScreen,
} from "../../components/terminal/terminalRegistry";
import { addAgentToLiveTeam, launchTeam } from "../teamLauncher";
import { runQuickSuggest, runSuperBrainTeamBroadcast } from "../superBrain";
import { parseMessages, type TeamMessage } from "../teamMessages";
import { renderRolePrompt, type TeamRole } from "../teamRoles";
import {
  appendBoardEntry,
  labelSlug,
  scanOutline,
  type BoardSection,
} from "../teamBoard";
import { syncOperatorInboxSubscriptions } from "../operatorInbox";
import { unsubscribeTeamRpc } from "../teamRpc";

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
  | "team_broadcast"
  | "team_send_to_pane"
  | "read_team_messages"
  | "launch_team"
  | "quick_suggest"
  | "read_team_board"
  | "team_pane_status"
  | "list_operator_pings"
  | "acknowledge_operator_pings"
  | "read_team_prompt"
  | "add_team_agent"
  | "update_team_agent"
  | "remove_team_agent"
  | "set_team_status"
  | "team_pane_focus"
  | "append_team_board_entry";

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
      "Return what is currently on a terminal pane's screen — including TUI apps (claude code, vim, top) that never finish a command. Reads the live xterm buffer (alt-screen for TUIs, viewport+scrollback for normal shells) plus metadata about the most recent finished OSC 133 command when one exists.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        pane_id: { type: "string", description: "Pane id from list_panes" },
        last_n: {
          type: "integer",
          description:
            "Tail this many lines from the active buffer (default: visible viewport size, typically ~24).",
          minimum: 1,
        },
      },
      required: ["pane_id"],
    },
    handler: async (args) => {
      const paneId = arg<string>(args, "pane_id");
      if (!paneId) return bad("missing pane_id");
      const lastN = arg<number>(args, "last_n");
      const screen = getTerminalScreen(paneId, lastN);
      if (!screen) return bad(`pane ${paneId} has no live terminal`);
      // Surface the latest finished command's output too (when present) so a
      // model that wanted "the last command result" still gets it without a
      // second tool call. quick_suggest still uses getTerminalContext for the
      // OSC-133-only behavior it needs.
      const ctx = getTerminalContext(paneId);
      return ok({
        screen: screen.screen,
        bufferType: screen.bufferType,
        lastBlockState: screen.lastBlockState,
        lastCommand: screen.lastCommand,
        lastExitCode: screen.lastExitCode,
        lastFinishedOutput: ctx ? ctx.output : null,
      });
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
    name: "team_broadcast",
    description:
      "Write text into every terminal pane of a team (the multi-agent equivalent of write_pane). with_newline=false (default) leaves the bytes at each prompt for the operator to review and press Enter; with_newline=true executes immediately in every pane.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        text: { type: "string" },
        with_newline: {
          type: "boolean",
          description: "Append \\n in every pane to execute. Default false.",
        },
      },
      required: ["team_id", "text"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const text = arg<string>(args, "text");
      const withNewline = arg<boolean>(args, "with_newline") ?? false;
      if (!teamId) return bad("missing team_id");
      if (text == null) return bad("missing text");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      if (!team.tabId) return bad(`team ${teamId} has no live tab`);
      try {
        const payload = withNewline ? `${text}\n` : text;
        const result = await runSuperBrainTeamBroadcast(team.tabId, payload);
        return ok({ teamId, ...result, submitted: withNewline });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "team_send_to_pane",
    description:
      "Write text into one specific team pane, addressed by paneId or by the team-agent label (e.g. \"Coordinator 1\"). with_newline=false (default) leaves bytes at the prompt; with_newline=true executes.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        pane_id: { type: "string", description: "Exact paneId; takes precedence over label" },
        label: { type: "string", description: "Team-agent label, e.g. \"Coordinator 1\"" },
        text: { type: "string" },
        with_newline: { type: "boolean", description: "Append \\n. Default false." },
      },
      required: ["team_id", "text"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const text = arg<string>(args, "text");
      const withNewline = arg<boolean>(args, "with_newline") ?? false;
      let paneId = arg<string>(args, "pane_id");
      const label = arg<string>(args, "label");
      if (!teamId) return bad("missing team_id");
      if (text == null) return bad("missing text");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      if (!paneId && label) {
        const roster = useTeamStore.getState().agents[teamId] ?? [];
        const match = roster.find((a) => a.label === label);
        if (!match) return bad(`label "${label}" not found in team roster`);
        if (!match.paneId) return bad(`agent "${label}" has no live pane`);
        paneId = match.paneId;
      }
      if (!paneId) return bad("provide pane_id or label");
      const ctx = getTerminalContext(paneId);
      if (!ctx) return bad(`pane ${paneId} has no live PTY session`);
      const payload = withNewline ? `${text}\n` : text;
      try {
        await ptyWrite(ctx.sessionId, new TextEncoder().encode(payload));
        return ok({ teamId, paneId, wroteBytes: payload.length, submitted: withNewline });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "read_team_messages",
    description:
      "On-demand read of a team's MESSAGES.md log (the inter-agent + @operator chat). Returns parsed messages newest-first. Use filters to scope by sender/recipient/type or to fetch only messages newer than a known timestamp.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        since_ts: {
          type: "string",
          description: "ISO timestamp; only messages with ts > since_ts are returned",
        },
        from: { type: "string", description: "Filter by sender label" },
        to: {
          type: "string",
          description: "Filter by recipient (label, @all, or @operator)",
        },
        type: {
          type: "string",
          enum: ["message", "status", "escalation", "done"],
        },
        limit: { type: "integer", minimum: 1, description: "Cap; default 50" },
      },
      required: ["team_id"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      if (!teamId) return bad("missing team_id");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      const sinceTs = arg<string>(args, "since_ts");
      const fromFilter = arg<string>(args, "from");
      const toFilter = arg<string>(args, "to");
      const typeFilter = arg<string>(args, "type");
      const limit = arg<number>(args, "limit") ?? 50;
      try {
        let content = "";
        try {
          content = await readTextFile(`${team.teamDir}/MESSAGES.md`);
        } catch {
          // file may not exist yet — empty log
        }
        const all = parseMessages(content);
        const filtered = all.filter((m: TeamMessage) => {
          if (sinceTs && m.ts <= sinceTs) return false;
          if (fromFilter && m.from !== fromFilter) return false;
          if (toFilter && m.to !== toFilter) return false;
          if (typeFilter && m.type !== typeFilter) return false;
          return true;
        });
        const sliced = filtered.slice(-limit).reverse();
        return ok({
          teamId,
          total: filtered.length,
          returned: sliced.length,
          truncated: filtered.length > sliced.length,
          messages: sliced,
        });
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
  {
    name: "read_team_board",
    description:
      "Read a team's BOARD.md (the coordination spine — goal, roster, task breakdown, agent status, completed work log). Returns raw markdown plus a best-effort heading outline; parse the sections you need from raw using the outline byte offsets.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: { team_id: { type: "string" } },
      required: ["team_id"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      if (!teamId) return bad("missing team_id");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      let raw = "";
      let exists = true;
      try {
        raw = await readTextFile(`${team.teamDir}/BOARD.md`);
      } catch {
        exists = false;
      }
      const agents = useTeamStore.getState().agents[teamId] ?? [];
      return ok({
        teamId,
        teamDir: team.teamDir,
        teamName: team.name,
        status: team.status,
        agentLabels: agents.map((a) => a.label),
        exists,
        raw,
        outline: scanOutline(raw),
      });
    },
  },
  {
    name: "team_pane_status",
    description:
      "Per-agent live status for a team: pane id, session liveness, the most recent OSC-133 block state (prompting/running/finished/null), last command + exit code, and the trailing N lines of the screen. Lets you see which agents are stuck without one read_pane_output call per agent.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        tail_lines: {
          type: "integer",
          minimum: 1,
          description: "Trailing lines of each pane's screen to include. Default 8.",
        },
      },
      required: ["team_id"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      if (!teamId) return bad("missing team_id");
      const ts = useTeamStore.getState();
      const team = ts.teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      const tailLines = arg<number>(args, "tail_lines") ?? 8;
      const roster = ts.agents[teamId] ?? [];
      const statuses = roster.map((a) => {
        const screen = a.paneId ? getTerminalScreen(a.paneId, tailLines) : null;
        const tail = screen
          ? screen.screen.split(/\r?\n/).slice(-tailLines).join("\n")
          : null;
        return {
          label: a.label,
          role: a.role,
          agentId: a.agentId,
          paneId: a.paneId ?? null,
          sessionAlive: !!screen,
          bufferType: screen?.bufferType ?? null,
          lastBlockState: screen?.lastBlockState ?? null,
          lastCommand: screen?.lastCommand ?? null,
          lastExitCode: screen?.lastExitCode ?? null,
          screenTail: tail,
        };
      });
      return ok({ teamId, tabId: team.tabId ?? null, status: team.status, agents: statuses });
    },
  },
  {
    name: "list_operator_pings",
    description:
      "List unread @operator + escalation messages currently in the operator inbox (across all teams). Read-only — does NOT mark anything read; use acknowledge_operator_pings for that.",
    readOnly: true,
    parameters: { type: "object", properties: {}, required: [] },
    handler: async () => {
      const s = useOperatorInboxStore.getState();
      return ok({
        unread: s.pings,
        lastSeenTs: s.lastSeenTs,
        totalUnread: s.pings.length,
      });
    },
  },
  {
    name: "acknowledge_operator_pings",
    description:
      "Mark operator-inbox pings as read. Pass msg_ids to clear specific ones, or all=true to clear everything. Use only after you have actually replied (e.g. via tmsg_send addressed to the escalating agent).",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        msg_ids: { type: "array", items: { type: "string" } },
        all: { type: "boolean" },
      },
      required: [],
    },
    handler: async (args) => {
      const all = arg<boolean>(args, "all");
      const ids = arg<string[]>(args, "msg_ids") ?? [];
      const store = useOperatorInboxStore.getState();
      if (all) {
        const cleared = store.pings.length;
        store.markAllRead();
        return ok({ cleared, mode: "all" });
      }
      if (ids.length === 0) return bad("provide msg_ids or all=true");
      let cleared = 0;
      for (const id of ids) {
        if (store.pings.some((p) => p.msgId === id)) cleared++;
        store.markRead(id);
      }
      return ok({ cleared, mode: "ids" });
    },
  },
  {
    name: "read_team_prompt",
    description:
      "Read a team agent's rendered prompt file at <teamDir>/.prompts/<labelSlug>.md — the one fed to the AI CLI as {task_file}. Use before update_team_agent so you're not editing blind.",
    readOnly: true,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        label: { type: "string" },
      },
      required: ["team_id", "label"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const label = arg<string>(args, "label");
      if (!teamId || !label) return bad("missing team_id / label");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      const path = `${team.teamDir}/.prompts/${labelSlug(label)}.md`;
      try {
        const content = await readTextFile(path);
        return ok({ path, content });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "add_team_agent",
    description:
      "Grow a live team's roster by one agent. Persists the row, renders the prompt, splits a pane next to anchor_pane_id (or the rightmost terminal leaf), and starts the agent CLI. agent_id defaults to the team's first agent's program.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        label: { type: "string", description: "Unique label within the team" },
        role: { type: "string", description: "TeamRole id (e.g. coordinator, builder, reviewer, custom)" },
        agent_id: { type: "string", description: "Kanban agent program id (from list_agents)" },
        system_prompt_override: { type: "string" },
        anchor_pane_id: { type: "string", description: "Defaults to the team tab's rightmost terminal leaf" },
        split: { type: "string", enum: ["vertical", "horizontal"], description: "Default vertical" },
      },
      required: ["team_id", "label", "role"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const label = arg<string>(args, "label");
      const roleStr = arg<string>(args, "role");
      if (!teamId || !label || !roleStr) return bad("missing team_id / label / role");
      const settings = useTeamSettingsStore.getState().settings;
      try {
        const result = await addAgentToLiveTeam({
          teamId,
          label,
          role: roleStr as TeamRole,
          agentId: arg<string>(args, "agent_id"),
          systemPromptOverride: arg<string>(args, "system_prompt_override"),
          anchorPaneId: arg<string>(args, "anchor_pane_id"),
          splitDirection: arg<"vertical" | "horizontal">(args, "split"),
          customRoles: settings.customRoles,
          customSkills: settings.customSkills,
        });
        return ok(result);
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "update_team_agent",
    description:
      "Edit a team agent's role / agent_id / system_prompt_override. Re-renders <teamDir>/.prompts/<labelSlug>.md. By default the live PTY is left running (the agent picks up the new prompt next time it re-reads {task_file}); pass respawn=true to close the pane and re-open it in place. Changing agent_id forces respawn=true.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        label: { type: "string" },
        role: { type: "string" },
        agent_id: { type: "string" },
        system_prompt_override: {
          type: "string",
          description: "Set to empty string to clear the override and revert to the default role prompt.",
        },
        respawn: { type: "boolean", description: "Default false. Required when agent_id changes." },
      },
      required: ["team_id", "label"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const label = arg<string>(args, "label");
      if (!teamId || !label) return bad("missing team_id / label");
      const ts = useTeamStore.getState();
      const team = ts.teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      const agent = (ts.agents[teamId] ?? []).find((a) => a.label === label);
      if (!agent) return bad(`label "${label}" not found in team roster`);

      const newRole = arg<string>(args, "role") as TeamRole | undefined;
      const newAgentId = arg<string>(args, "agent_id");
      const overrideRaw = arg<string>(args, "system_prompt_override");
      const respawnRequested = arg<boolean>(args, "respawn") ?? false;
      const agentIdChanged = !!newAgentId && newAgentId !== agent.agentId;
      if (agentIdChanged && !respawnRequested) {
        return bad("agent_id change requires respawn=true (CLI rewrite)");
      }
      // Empty string clears the override; undefined leaves it untouched.
      const overridePatch =
        overrideRaw === undefined
          ? undefined
          : overrideRaw === ""
            ? null
            : overrideRaw;

      const updated = await ts.updateAgent(agent.id, {
        role: newRole,
        agentId: newAgentId,
        systemPromptOverride: overridePatch,
      });

      // Re-render the prompt file with the new role / override.
      const settings = useTeamSettingsStore.getState().settings;
      const customRoles = settings.customRoles;
      const customSkills = settings.customSkills;
      const skillIds = ts.skills[teamId] ?? [];
      const attachments = ts.attachments[teamId] ?? [];
      const { renderSkillsMarkdown } = await import("../teamSkills");
      const { roleLabel } = await import("../teamRoles");
      const skillsMd = renderSkillsMarkdown(skillIds, customSkills);
      const attachmentsMd = attachments.map((a) => `- ${a.path}`).join("\n");
      const allAgents = useTeamStore.getState().agents[teamId] ?? [];
      const rosterMd = allAgents
        .map((a) => `- **${a.label}** — ${roleLabel(a.role, customRoles)}`)
        .join("\n");
      const promptBody =
        updated.systemPromptOverride ??
        renderRolePrompt({
          role: updated.role,
          label: updated.label,
          goal: team.goal,
          teamDir: team.teamDir,
          boardPath: `${team.teamDir}/BOARD.md`,
          messagesPath: `${team.teamDir}/MESSAGES.md`,
          rosterMarkdown: rosterMd,
          skillsMarkdown: skillsMd,
          attachmentsMarkdown: attachmentsMd,
          customRoles,
        });
      await teamWritePrompt({ teamDir: team.teamDir, label: updated.label, body: promptBody });

      let respawnedPaneId: string | null = null;
      if (respawnRequested) {
        const ws = useWorkspaceStore.getState();
        const oldPaneId = updated.paneId;
        if (!oldPaneId || !team.tabId) {
          return bad("cannot respawn: agent has no live pane");
        }
        // Anchor on a sibling so the layout stays similar after close + split.
        const tab = ws.tabs.find((t) => t.id === team.tabId);
        const siblings = tab
          ? Object.keys(tab.panes).filter((id) => id !== oldPaneId && tab.panes[id]?.kind === "terminal")
          : [];
        const anchor = siblings[0];
        ws.closePane(team.tabId, oldPaneId);
        await ts.setPaneId(updated.id, undefined);
        if (!anchor) {
          return bad("respawn closed the pane but no sibling to anchor a fresh split — re-add manually");
        }
        const result = await addAgentToLiveTeam({
          teamId,
          label: updated.label,
          role: updated.role,
          agentId: updated.agentId,
          systemPromptOverride: updated.systemPromptOverride,
          anchorPaneId: anchor,
          splitDirection: "vertical",
          customRoles,
          customSkills,
        });
        respawnedPaneId = result.paneId;
      }

      return ok({
        teamAgentId: updated.id,
        label: updated.label,
        role: updated.role,
        agentId: updated.agentId,
        systemPromptOverride: updated.systemPromptOverride ?? null,
        respawned: respawnRequested,
        paneId: respawnedPaneId ?? updated.paneId ?? null,
      });
    },
  },
  {
    name: "remove_team_agent",
    description:
      "Close a team agent's pane and clear its paneId. Soft delete — the team_agents row is preserved so resume can revive the agent later.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        label: { type: "string" },
      },
      required: ["team_id", "label"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const label = arg<string>(args, "label");
      if (!teamId || !label) return bad("missing team_id / label");
      const ts = useTeamStore.getState();
      const team = ts.teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      const agent = (ts.agents[teamId] ?? []).find((a) => a.label === label);
      if (!agent) return bad(`label "${label}" not found in team roster`);
      if (!agent.paneId || !team.tabId) {
        return bad(`agent "${label}" has no live pane`);
      }
      useWorkspaceStore.getState().closePane(team.tabId, agent.paneId);
      await ts.setPaneId(agent.id, undefined);
      return ok({ teamAgentId: agent.id, label, removedPane: agent.paneId, softDelete: true });
    },
  },
  {
    name: "set_team_status",
    description:
      "Archive or reactivate a team. Archive stops the watchers and unsubscribes RPC + operator inbox. Reactivate clears tabId and per-agent paneIds — you must follow up with launch_team to actually start panes again.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        status: { type: "string", enum: ["active", "archived"] },
      },
      required: ["team_id", "status"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const status = arg<string>(args, "status");
      if (!teamId || !status) return bad("missing team_id / status");
      const ts = useTeamStore.getState();
      const team = ts.teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      try {
        if (status === "archived") {
          await ts.archive(teamId);
          unsubscribeTeamRpc(teamId);
          await syncOperatorInboxSubscriptions();
        } else if (status === "active") {
          await ts.reactivate(teamId);
          await syncOperatorInboxSubscriptions();
        } else {
          return bad(`unknown status: ${status}`);
        }
        return ok({ teamId, status, hint: status === "active" ? "call launch_team to start panes" : null });
      } catch (e) {
        return bad(e instanceof Error ? e.message : String(e));
      }
    },
  },
  {
    name: "team_pane_focus",
    description:
      "Bring a team agent's pane into focus — switches to the team's tab and makes the agent's pane active. Use to direct the operator's attention before handing back.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        label: { type: "string" },
      },
      required: ["team_id", "label"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const label = arg<string>(args, "label");
      if (!teamId || !label) return bad("missing team_id / label");
      const ts = useTeamStore.getState();
      const team = ts.teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      if (!team.tabId) return bad(`team ${team.name} has no live tab`);
      const agent = (ts.agents[teamId] ?? []).find((a) => a.label === label);
      if (!agent) return bad(`label "${label}" not found in team roster`);
      if (!agent.paneId) return bad(`agent "${label}" has no live pane`);
      const ws = useWorkspaceStore.getState();
      ws.setActiveTab(team.tabId);
      ws.setActivePane(team.tabId, agent.paneId);
      return ok({ teamId, tabId: team.tabId, paneId: agent.paneId, label });
    },
  },
  {
    name: "append_team_board_entry",
    description:
      "Append an entry to a section of a team's BOARD.md. Append-only by design (the seed `_WAITING_` placeholder etc. are preserved). For section=agent_status you must pass label; the entry is inserted under `### <label>` (timestamped). If the section heading is missing, a fresh `## <Title>` is appended at EOF.",
    readOnly: false,
    parameters: {
      type: "object",
      properties: {
        team_id: { type: "string" },
        section: {
          type: "string",
          enum: ["task_breakdown", "agent_status", "completed_work", "attachments"],
        },
        label: { type: "string", description: "Required when section=agent_status" },
        content: { type: "string", description: "Markdown row / line / paragraph" },
        timestamp: { type: "boolean", description: "Prefix with ISO timestamp. Default true." },
      },
      required: ["team_id", "section", "content"],
    },
    handler: async (args) => {
      const teamId = arg<string>(args, "team_id");
      const section = arg<string>(args, "section") as BoardSection | undefined;
      const content = arg<string>(args, "content");
      const label = arg<string>(args, "label");
      const timestamp = arg<boolean>(args, "timestamp");
      if (!teamId || !section || content == null) return bad("missing team_id / section / content");
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) return bad(`team ${teamId} not found`);
      if (section === "agent_status" && !label) return bad("section=agent_status requires label");
      try {
        const result = await appendBoardEntry({
          boardPath: `${team.teamDir}/BOARD.md`,
          section,
          label,
          content,
          timestamp,
        });
        return ok({ teamId, section, label: label ?? null, ...result });
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
