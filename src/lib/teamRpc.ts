import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  agentLaunch,
  ptyWrite,
  teamRpcDrain,
  teamRpcReply,
  teamWritePrompt,
  type TeamRpcEvent,
} from "./tauri";
import { getTerminalContext } from "../components/terminal/terminalRegistry";
import { useKanbanStore } from "../stores/kanbanStore";
import { useTeamStore } from "../stores/teamStore";
import { useWorkspaceStore, type PanePreset } from "../stores/workspaceStore";
import { renderRolePrompt, ROLE_LABELS, type TeamRole } from "./teamRoles";
import { renderSkillsMarkdown } from "./teamSkills";

type RpcRequest = {
  action:
    | "pane.new"
    | "pane.close"
    | "pane.read"
    | "pane.write";
  from: string;
  label?: string;
  role?: string;
  body?: string;
  lastN?: number | null;
};

type RpcResult = { ok: true; data: unknown } | { ok: false; error: string };

const subscriptions = new Map<string, UnlistenFn>();

/**
 * Subscribe to a team's RPC channel. Each `tmsg pane …` call from inside an
 * agent shell drops a `<uuid>.req` file under <teamDir>/.rpc/; the Rust
 * watcher emits `team:rpc:<teamId>` events and we execute the action and
 * write the response back via team_rpc_reply.
 *
 * Idempotent — calling twice replaces the listener. Returns an unsubscribe.
 */
export async function subscribeTeamRpc(teamId: string, teamDir: string): Promise<UnlistenFn> {
  const existing = subscriptions.get(teamId);
  if (existing) {
    existing();
    subscriptions.delete(teamId);
  }
  const unlisten = await listen<TeamRpcEvent>(`team:rpc:${teamId}`, async (ev) => {
    await handleEvent(teamDir, ev.payload);
  });

  // Drain any leftover requests written before we subscribed (or while the
  // app was closed) so agents don't hang forever on first launch / resume.
  try {
    const pending = await teamRpcDrain(teamDir);
    for (const p of pending) {
      await handleEvent(teamDir, {
        teamId,
        requestId: p.requestId,
        reqPath: p.reqPath,
        payload: p.payload,
      });
    }
  } catch (e) {
    console.warn("teamRpcDrain failed", e);
  }

  subscriptions.set(teamId, unlisten);
  return () => {
    unlisten();
    subscriptions.delete(teamId);
  };
}

export function unsubscribeTeamRpc(teamId: string) {
  const fn = subscriptions.get(teamId);
  if (fn) {
    fn();
    subscriptions.delete(teamId);
  }
}

async function handleEvent(teamDir: string, ev: TeamRpcEvent): Promise<void> {
  let parsed: RpcRequest | null = null;
  try {
    parsed = JSON.parse(ev.payload) as RpcRequest;
  } catch (err) {
    await reply(teamDir, ev.requestId, { ok: false, error: `bad payload: ${String(err)}` });
    return;
  }

  let result: RpcResult;
  try {
    switch (parsed.action) {
      case "pane.read":
        result = await handleRead(parsed);
        break;
      case "pane.write":
        result = await handleWrite(parsed);
        break;
      case "pane.close":
        result = await handleClose(parsed);
        break;
      case "pane.new":
        result = await handleNew(parsed, teamDir);
        break;
      default:
        result = { ok: false, error: `unknown action: ${parsed.action}` };
    }
  } catch (err) {
    result = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  await reply(teamDir, ev.requestId, result);
}

async function reply(teamDir: string, requestId: string, result: RpcResult): Promise<void> {
  const body = result.ok
    ? typeof result.data === "string"
      ? result.data
      : JSON.stringify(result.data, null, 2)
    : `error: ${result.error}`;
  await teamRpcReply({
    teamDir,
    requestId,
    response: body.endsWith("\n") ? body : body + "\n",
  });
}

function findAgentByLabel(label: string) {
  const state = useTeamStore.getState();
  for (const team of state.teams) {
    const list = state.agents[team.id] ?? [];
    const a = list.find((x) => x.label === label);
    if (a) return { team, agent: a };
  }
  return undefined;
}

async function handleRead(req: RpcRequest): Promise<RpcResult> {
  const label = req.label?.trim();
  if (!label) return { ok: false, error: "missing --label" };
  const found = findAgentByLabel(label);
  if (!found || !found.agent.paneId) {
    return { ok: false, error: `no live pane for label ${label}` };
  }
  const ctx = getTerminalContext(found.agent.paneId);
  if (!ctx) {
    return { ok: false, error: `no completed command block for ${label} yet` };
  }
  const tail = req.lastN && req.lastN > 0
    ? ctx.output.split(/\r?\n/).slice(-req.lastN).join("\n")
    : ctx.output;
  return {
    ok: true,
    data: `command: ${ctx.command}\nexit: ${ctx.exitCode ?? "?"}\noutput:\n${tail}`,
  };
}

async function handleWrite(req: RpcRequest): Promise<RpcResult> {
  const label = req.label?.trim();
  const body = req.body ?? "";
  if (!label) return { ok: false, error: "missing --label" };
  if (!body) return { ok: false, error: "missing --body" };
  const found = findAgentByLabel(label);
  if (!found || !found.agent.paneId) {
    return { ok: false, error: `no live pane for label ${label}` };
  }
  const ctx = getTerminalContext(found.agent.paneId);
  if (!ctx) {
    return { ok: false, error: `pane ${label} has no live PTY session yet` };
  }
  // Never auto-execute — write bytes only. Receiver will see the draft and
  // press Enter to submit. Mirrors the Super Brain rule.
  await ptyWrite(ctx.sessionId, new TextEncoder().encode(body));
  return { ok: true, data: `wrote ${body.length} bytes to ${label} (no newline)` };
}

async function handleClose(req: RpcRequest): Promise<RpcResult> {
  const label = req.label?.trim();
  if (!label) return { ok: false, error: "missing --label" };
  const found = findAgentByLabel(label);
  if (!found || !found.agent.paneId) {
    return { ok: false, error: `no live pane for label ${label}` };
  }
  const tabId = found.team.tabId;
  if (!tabId) return { ok: false, error: `team ${found.team.name} has no live tab` };
  useWorkspaceStore.getState().closePane(tabId, found.agent.paneId);
  await useTeamStore.getState().setPaneId(found.agent.id, undefined);
  return { ok: true, data: `closed pane ${label}` };
}

async function handleNew(req: RpcRequest, teamDir: string): Promise<RpcResult> {
  const label = req.label?.trim();
  const role = (req.role ?? "builder").toLowerCase() as TeamRole;
  const fromLabel = req.from;
  if (!label) return { ok: false, error: "missing --label" };
  const fromInfo = findAgentByLabel(fromLabel);
  if (!fromInfo) return { ok: false, error: `requester ${fromLabel} not found in any team` };
  const team = fromInfo.team;
  if (!team.tabId) return { ok: false, error: `team ${team.name} has no live tab` };

  // Reuse the requester's program agent (Claude/Codex/...) for the new pane.
  const kanbanAgents = useKanbanStore.getState().agents;
  const programAgent = kanbanAgents.find((a) => a.id === fromInfo.agent.agentId);
  if (!programAgent) return { ok: false, error: `agent program for ${fromLabel} not found` };

  // Persist the new team_agents row.
  const teamState = useTeamStore.getState();
  const existing = teamState.agents[team.id] ?? [];
  if (existing.some((a) => a.label === label)) {
    return { ok: false, error: `label ${label} already in roster` };
  }
  const ordinal = existing.length;
  const newAgent = {
    label,
    role,
    agentId: fromInfo.agent.agentId,
  };

  // Insert via the store's create helper would re-create the team; instead
  // we mint a row directly. Reuse the existing patterns in teamStore by
  // calling create on a one-off, but for simplicity here we just call the
  // db through a thin path. For now, fail with a clear message and let the
  // operator add the agent through the picker — full dynamic add is
  // out-of-scope of this request.
  // (The frontend RPC bridge stays read-mostly until we surface a
  //  teamStore.addAgent helper.)
  void newAgent;
  void programAgent;
  void teamDir;
  void ordinal;
  return {
    ok: false,
    error: "tmsg pane new is not supported yet — add the agent via the Team picker",
  };
}

/**
 * Helper used by teamLauncher / resume to (re)build a PanePreset for a single
 * agent. Kept here so the launcher and a future "add agent dynamically" path
 * share one source of truth.
 */
export async function buildAgentPreset(args: {
  team: { id: string; name: string; goal: string; projectPath: string; teamDir: string };
  agent: { id: string; label: string; role: TeamRole };
  programCommand: string;
  programSystemPrompt: string;
  programEnvJson: string;
  paths: { boardPath: string; messagesPath: string; tmsgPath: string };
  rosterMarkdown: string;
  skillIds: string[];
}): Promise<PanePreset> {
  const promptBody = renderRolePrompt({
    role: args.agent.role,
    label: args.agent.label,
    goal: args.team.goal,
    teamDir: args.team.teamDir,
    boardPath: args.paths.boardPath,
    messagesPath: args.paths.messagesPath,
    rosterMarkdown: args.rosterMarkdown,
    skillsMarkdown: renderSkillsMarkdown(args.skillIds),
    attachmentsMarkdown: "",
  });
  const promptFile = await teamWritePrompt({
    teamDir: args.team.teamDir,
    label: args.agent.label,
    body: promptBody,
  });
  const plan = await agentLaunch({
    agentCommand: args.programCommand,
    taskId: `${args.team.id}:${args.agent.id}`,
    taskTitle: `${args.agent.label} — ${args.team.name}`,
    taskBody: promptBody,
    taskColumn: "",
    systemPrompt: args.programSystemPrompt,
    envJson: args.programEnvJson,
  });
  const command = args.programCommand
    .replace(/\{task_file\}/g, promptFile.path)
    .replace(/\{task_id\}/g, `'${args.team.id}:${args.agent.id}'`)
    .replace(/\{task_title\}/g, `'${args.agent.label.replace(/'/g, "'\\''")} — ${args.team.name.replace(/'/g, "'\\''")}'`)
    .replace(/\{task_column\}/g, "''");
  return {
    kind: "terminal",
    pendingCommand: command,
    spawnEnv: {
      ...plan.env,
      TEAMSHIP_TASK_FILE: promptFile.path,
      TEAMSHIP_TEAM_DIR: args.team.teamDir,
      TEAMSHIP_TEAM_ID: args.team.id,
      TEAMSHIP_TEAM_NAME: args.team.name,
      TEAMSHIP_AGENT_LABEL: args.agent.label,
      TEAMSHIP_AGENT_ROLE: args.agent.role,
      TEAMSHIP_AGENT_ID: args.agent.id,
      TEAMSHIP_BOARD_PATH: args.paths.boardPath,
      TEAMSHIP_MESSAGES_PATH: args.paths.messagesPath,
      TEAMSHIP_TEAM_TMSG: args.paths.tmsgPath,
    },
    spawnCwd: args.team.projectPath,
    title: `${args.agent.label} (${ROLE_LABELS[args.agent.role] ?? args.agent.role})`,
  };
}
