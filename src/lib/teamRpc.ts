import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  agentLaunch,
  ptyWrite,
  teamInit,
  teamRpcDrain,
  teamRpcReply,
  teamWritePrompt,
  type TeamRpcEvent,
} from "./tauri";
import { getTerminalContext } from "../components/terminal/terminalRegistry";
import { useKanbanStore } from "../stores/kanbanStore";
import { useTeamStore } from "../stores/teamStore";
import { useWorkspaceStore, type PanePreset } from "../stores/workspaceStore";
import {
  renderRolePrompt,
  ROLE_LABELS,
  TEAM_ROLES,
  type TeamRole,
} from "./teamRoles";
import { renderSkillsMarkdown } from "./teamSkills";
import type { LayoutNode } from "./types";

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
  const roleRaw = (req.role ?? "builder").toLowerCase();
  const role = (TEAM_ROLES as readonly string[]).includes(roleRaw)
    ? (roleRaw as TeamRole)
    : ("custom" as TeamRole);
  const fromLabel = req.from;
  if (!label) return { ok: false, error: "missing --label" };
  const fromInfo = findAgentByLabel(fromLabel);
  if (!fromInfo) return { ok: false, error: `requester ${fromLabel} not found in any team` };
  const team = fromInfo.team;
  if (!team.tabId) return { ok: false, error: `team ${team.name} has no live tab` };

  // Reuse the requester's AI program (Claude/Codex/...) for the new pane.
  // The Coordinator can re-target by editing team_agents later.
  const kanbanAgents = useKanbanStore.getState().agents;
  const programAgent = kanbanAgents.find((a) => a.id === fromInfo.agent.agentId);
  if (!programAgent) return { ok: false, error: `AI program for ${fromLabel} not found` };

  // Persist the new team_agents row first so resume can pick it up even if
  // the split fails partway.
  let newTa;
  try {
    newTa = await useTeamStore.getState().addAgent(team.id, {
      label,
      role,
      agentId: fromInfo.agent.agentId,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  // Re-run team_init so prompt files / paths refresh (idempotent — BOARD.md
  // is preserved if it exists). teamDir from the event already points here,
  // but we use the result to keep the contract identical to launchTeam.
  void teamDir;
  const teamState = useTeamStore.getState();
  const skillIds = teamState.skills[team.id] ?? [];
  const teamAgents = teamState.agents[team.id] ?? [];
  const skillsMd = renderSkillsMarkdown(skillIds);
  const rosterMd = teamAgents
    .map((a) => `- **${a.label}** — ${ROLE_LABELS[a.role] ?? a.role}`)
    .join("\n");
  const paths = await teamInit({
    teamId: team.id,
    projectPath: team.projectPath,
    boardMarkdown: `# Team Board: ${team.name}\n\n## Roster\n${rosterMd}\n`,
  });

  // Build the role prompt and the pendingCommand the same way the launcher does.
  const promptBody = renderRolePrompt({
    role,
    label,
    goal: team.goal,
    teamDir: paths.teamDir,
    boardPath: paths.boardPath,
    messagesPath: paths.messagesPath,
    rosterMarkdown: rosterMd,
    skillsMarkdown: skillsMd,
    attachmentsMarkdown: "",
  });
  const promptFile = await teamWritePrompt({
    teamDir: paths.teamDir,
    label,
    body: promptBody,
  });
  const plan = await agentLaunch({
    agentCommand: programAgent.command,
    taskId: `${team.id}:${newTa.id}`,
    taskTitle: `${label} — ${team.name}`,
    taskBody: promptBody,
    taskColumn: "",
    systemPrompt: programAgent.systemPrompt,
    envJson: programAgent.envJson,
  });
  const command = programAgent.command
    .replace(/\{task_file\}/g, promptFile.path)
    .replace(/\{task_id\}/g, shellQuote(`${team.id}:${newTa.id}`))
    .replace(/\{task_title\}/g, shellQuote(`${label} — ${team.name}`))
    .replace(/\{task_column\}/g, shellQuote(""));

  const preset: PanePreset = {
    kind: "terminal",
    pendingCommand: command,
    spawnEnv: {
      ...plan.env,
      TEAMSHIP_TASK_FILE: promptFile.path,
      TEAMSHIP_TEAM_DIR: paths.teamDir,
      TEAMSHIP_TEAM_ID: team.id,
      TEAMSHIP_TEAM_NAME: team.name,
      TEAMSHIP_AGENT_LABEL: label,
      TEAMSHIP_AGENT_ROLE: role,
      TEAMSHIP_AGENT_ID: newTa.id,
      TEAMSHIP_BOARD_PATH: paths.boardPath,
      TEAMSHIP_MESSAGES_PATH: paths.messagesPath,
      TEAMSHIP_TEAM_TMSG: paths.tmsgPath,
    },
    spawnCwd: team.projectPath,
    title: `${label} (${ROLE_LABELS[role] ?? role})`,
  };

  // Split off the requester's own pane so the new agent ends up adjacent.
  // Identify the new pane by diffing the layout's leaf set.
  const ws = useWorkspaceStore.getState();
  const tabBefore = ws.tabs.find((t) => t.id === team.tabId);
  const before = tabBefore ? new Set(collectLeafIds(tabBefore.layout)) : new Set<string>();
  const requesterPaneId = fromInfo.agent.paneId;
  if (!requesterPaneId) {
    return { ok: false, error: `requester ${fromLabel} has no live pane to split from` };
  }
  ws.splitPane(team.tabId, requesterPaneId, "vertical", preset);
  const tabAfter = useWorkspaceStore.getState().tabs.find((t) => t.id === team.tabId);
  if (!tabAfter) return { ok: false, error: "tab disappeared during split" };
  const newPaneId = collectLeafIds(tabAfter.layout).find((id) => !before.has(id));
  if (!newPaneId) return { ok: false, error: "split succeeded but new pane id not found" };

  await useTeamStore.getState().setPaneId(newTa.id, newPaneId);

  return {
    ok: true,
    data: `added ${label} (${role}) — pane ${newPaneId}`,
  };
}

function collectLeafIds(layout: LayoutNode): string[] {
  if (layout.type === "leaf") return [layout.paneId];
  return layout.children.flatMap(collectLeafIds);
}

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}
