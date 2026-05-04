import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ptyWrite,
  teamRpcDrain,
  teamRpcReply,
  type TeamRpcEvent,
} from "./tauri";
import { getTerminalContext } from "../components/terminal/terminalRegistry";
import { useTeamStore } from "../stores/teamStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { TEAM_ROLES, type TeamRole } from "./teamRoles";
import { addAgentToLiveTeam } from "./teamLauncher";

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

async function handleNew(req: RpcRequest, _teamDir: string): Promise<RpcResult> {
  const label = req.label?.trim();
  const roleRaw = (req.role ?? "builder").toLowerCase();
  const role = (TEAM_ROLES as readonly string[]).includes(roleRaw)
    ? (roleRaw as TeamRole)
    : ("custom" as TeamRole);
  if (!label) return { ok: false, error: "missing --label" };
  const fromInfo = findAgentByLabel(req.from);
  if (!fromInfo) return { ok: false, error: `requester ${req.from} not found in any team` };
  if (!fromInfo.agent.paneId) {
    return { ok: false, error: `requester ${req.from} has no live pane to split from` };
  }
  try {
    const result = await addAgentToLiveTeam({
      teamId: fromInfo.team.id,
      label,
      role,
      agentId: fromInfo.agent.agentId,
      // Anchor on the requester's pane so the new agent shows up adjacent.
      anchorPaneId: fromInfo.agent.paneId,
      splitDirection: "vertical",
    });
    return { ok: true, data: `added ${result.label} (${role}) — pane ${result.paneId}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
