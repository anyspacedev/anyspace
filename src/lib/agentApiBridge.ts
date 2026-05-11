import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  agentApiReply,
  ptyWrite,
  teamAppendMessage,
  teamReadMessagesText,
  type AgentApiRequestEvent,
} from "./tauri";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useKanbanStore } from "../stores/kanbanStore";
import { useTeamStore } from "../stores/teamStore";
import { useKnowledgeStore } from "../stores/knowledgeStore";
import {
  knowledgeList,
  knowledgeRead,
  knowledgeSearch,
  knowledgeWrite,
} from "./knowledge";
import { parseMessages, type TeamMessage } from "./teamMessages";
import { runSuperBrainTeamBroadcast } from "./superBrain";
import {
  getTerminalContext,
  getTerminalScreen,
  getTerminalSessionId,
} from "../components/terminal/terminalRegistry";
import { driveIframe, getPreviewIframe } from "./previewDrive";
import { capturePreviewIframeRaw } from "./previewCapture";
import type { LayoutNode, Pane, Tab, Task } from "./types";

type Handler = (payload: Record<string, unknown>) => Promise<unknown>;

const handlers = new Map<string, Handler>();

export function registerAgentApiHandler(action: string, handler: Handler) {
  handlers.set(action, handler);
}

export function unregisterAgentApiHandler(action: string) {
  handlers.delete(action);
}

let unlisten: UnlistenFn | null = null;

export async function startAgentApiBridge(): Promise<void> {
  if (unlisten) return;
  unlisten = await listen<AgentApiRequestEvent>("agent_api:request", async (ev) => {
    const { reqId, action, payload } = ev.payload;
    const handler = handlers.get(action);
    let response: unknown;
    if (!handler) {
      response = { ok: false, error: `unknown action: ${action}` };
    } else {
      try {
        response = await handler(payload ?? {});
      } catch (err) {
        response = {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
    try {
      await agentApiReply({ requestId: reqId, response });
    } catch (err) {
      console.warn("[agent_api] reply failed", reqId, err);
    }
  });
}

export async function stopAgentApiBridge(): Promise<void> {
  if (unlisten) {
    unlisten();
    unlisten = null;
  }
}

// ---- helpers ---------------------------------------------------------------

function findRequesterTab(
  requesterPaneId?: string,
  requesterTabId?: string,
): Tab | undefined {
  const ws = useWorkspaceStore.getState();
  if (requesterTabId) {
    const t = ws.tabs.find((t) => t.id === requesterTabId);
    if (t) return t;
  }
  if (requesterPaneId) {
    const t = ws.tabs.find((t) => t.panes[requesterPaneId]);
    if (t) return t;
  }
  return ws.tabs.find((t) => t.id === ws.activeTabId);
}

function collectLeafIds(layout: LayoutNode): string[] {
  if (layout.type === "leaf") return [layout.paneId];
  return layout.children.flatMap(collectLeafIds);
}

/**
 * Pick the best preview pane to act on. Resolution order:
 *   1. explicit targetPaneId, if it points at a preview pane
 *   2. a sibling preview pane in the requester's tab (the common case after
 *      `preview.open` from a terminal)
 *   3. any preview pane in the requester's tab
 *   4. any preview pane in the active tab
 */
function resolvePreviewPane(
  targetPaneId: string | undefined,
  requesterPaneId: string | undefined,
  requesterTabId: string | undefined,
): { tab: Tab; pane: Pane } | null {
  const ws = useWorkspaceStore.getState();
  if (targetPaneId) {
    for (const tab of ws.tabs) {
      const pane = tab.panes[targetPaneId];
      if (pane && pane.kind === "preview") return { tab, pane };
    }
  }
  const tab = findRequesterTab(requesterPaneId, requesterTabId);
  if (tab) {
    const previewPane = Object.values(tab.panes).find((p) => p.kind === "preview");
    if (previewPane) return { tab, pane: previewPane };
  }
  const activeTab = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (activeTab) {
    const previewPane = Object.values(activeTab.panes).find((p) => p.kind === "preview");
    if (previewPane) return { tab: activeTab, pane: previewPane };
  }
  return null;
}

function reqIds(payload: Record<string, unknown>): {
  requesterPaneId: string | undefined;
  requesterTabId: string | undefined;
} {
  return {
    requesterPaneId: (payload.requesterPaneId as string | undefined) || undefined,
    requesterTabId: (payload.requesterTabId as string | undefined) || undefined,
  };
}

// ---- handlers --------------------------------------------------------------

registerAgentApiHandler("panes.list", async (payload) => {
  const { requesterPaneId, requesterTabId } = reqIds(payload);
  const tab = findRequesterTab(requesterPaneId, requesterTabId);
  if (!tab) return { panes: [], tabId: null };
  const panes = Object.values(tab.panes).map((p) => ({
    id: p.id,
    kind: p.kind,
    title: (p.payload?.title as string | undefined) ?? null,
  }));
  return { tabId: tab.id, panes };
});

registerAgentApiHandler("preview.open", async (payload) => {
  const { requesterPaneId, requesterTabId } = reqIds(payload);
  const url = (payload.url as string | undefined) ?? undefined;
  const projectPath = (payload.projectPath as string | undefined) ?? undefined;
  const direction = (payload.direction as string | undefined) === "v" ? "vertical" : "horizontal";
  const engine = (payload.engine as string | undefined) ?? "iframe";
  if (engine !== "iframe") {
    return {
      ok: false,
      error: `engine "${engine}" not yet implemented — cross-origin WebviewWindow engine lands in a follow-up. Use engine:"iframe" (default) for localhost dev servers.`,
    };
  }
  if (!url && !projectPath) {
    return { ok: false, error: "preview.open requires url or projectPath" };
  }

  const ws = useWorkspaceStore.getState();
  const tab = findRequesterTab(requesterPaneId, requesterTabId);

  // Reuse an existing preview pane in the requester's tab if one is already
  // open — agents shouldn't accidentally fork the preview surface.
  if (tab) {
    const existing = Object.values(tab.panes).find((p) => p.kind === "preview");
    if (existing) {
      ws.setPanePayload(tab.id, existing.id, {
        ...(existing.payload ?? {}),
        ...(url ? { url } : {}),
        ...(projectPath ? { projectPath } : {}),
      });
      return { ok: true, paneId: existing.id, tabId: tab.id, reused: true };
    }
  }

  if (!tab) {
    // No active workspace at all — fall back to a fresh tab.
    const tabId = ws.newTab(
      1,
      "Preview",
      [{ kind: "preview", url, projectPath }],
      projectPath,
    );
    const newTab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
    const paneId = newTab ? collectLeafIds(newTab.layout)[0] : "";
    return { ok: true, paneId, tabId, reused: false };
  }

  // Anchor on the requester pane when it belongs to this tab; otherwise fall
  // back to the tab's active pane, then the first leaf. Default behavior is to
  // split a sibling preview into the current workspace — never spawn a new tab
  // just because the caller didn't pass a pane id.
  const anchorPaneId =
    requesterPaneId && tab.panes[requesterPaneId]
      ? requesterPaneId
      : tab.activePaneId && tab.panes[tab.activePaneId]
        ? tab.activePaneId
        : collectLeafIds(tab.layout)[0];
  if (!anchorPaneId) {
    return { ok: false, error: "no pane available to split" };
  }
  const before = new Set(collectLeafIds(tab.layout));
  ws.splitPane(tab.id, anchorPaneId, direction, {
    kind: "preview",
    url,
    projectPath,
  });
  const after = useWorkspaceStore.getState().tabs.find((t) => t.id === tab.id);
  const newPaneId = after ? collectLeafIds(after.layout).find((id) => !before.has(id)) : undefined;
  return { ok: true, paneId: newPaneId, tabId: tab.id, reused: false };
});

registerAgentApiHandler("preview.screenshot", async (payload) => {
  const targetPaneId = (payload.targetPaneId as string | undefined) ?? undefined;
  const { requesterPaneId, requesterTabId } = reqIds(payload);
  const target = resolvePreviewPane(targetPaneId, requesterPaneId, requesterTabId);
  if (!target) return { ok: false, error: "no preview pane available" };
  const iframe = getPreviewIframe(target.pane.id);
  if (!iframe) return { ok: false, error: `preview pane ${target.pane.id} has no iframe ref yet` };
  const result = await capturePreviewIframeRaw(iframe);
  return {
    ok: true,
    paneId: target.pane.id,
    path: result.path,
    width: iframe.clientWidth,
    height: iframe.clientHeight,
  };
});

registerAgentApiHandler("preview.click", async (payload) => {
  const targetPaneId = (payload.targetPaneId as string | undefined) ?? undefined;
  const { requesterPaneId, requesterTabId } = reqIds(payload);
  const selector = String(payload.selector ?? "");
  if (!selector) return { ok: false, error: "selector required" };
  const target = resolvePreviewPane(targetPaneId, requesterPaneId, requesterTabId);
  if (!target) return { ok: false, error: "no preview pane available" };
  const result = await driveIframe(target.pane.id, "drive:click", { selector });
  return result;
});

registerAgentApiHandler("preview.fill", async (payload) => {
  const targetPaneId = (payload.targetPaneId as string | undefined) ?? undefined;
  const { requesterPaneId, requesterTabId } = reqIds(payload);
  const selector = String(payload.selector ?? "");
  const value = payload.value == null ? "" : String(payload.value);
  const submit = !!payload.submit;
  if (!selector) return { ok: false, error: "selector required" };
  const target = resolvePreviewPane(targetPaneId, requesterPaneId, requesterTabId);
  if (!target) return { ok: false, error: "no preview pane available" };
  const result = await driveIframe(target.pane.id, "drive:fill", {
    selector,
    value,
    submit,
  });
  return result;
});

registerAgentApiHandler("preview.navigate", async (payload) => {
  const targetPaneId = (payload.targetPaneId as string | undefined) ?? undefined;
  const { requesterPaneId, requesterTabId } = reqIds(payload);
  const url = (payload.url as string | undefined) ?? undefined;
  if (!url) return { ok: false, error: "url required" };
  const target = resolvePreviewPane(targetPaneId, requesterPaneId, requesterTabId);
  if (!target) return { ok: false, error: "no preview pane available" };
  // Mutate payload — the iframe key includes url, so this remounts the iframe
  // with the new src. Avoids needing an iframe-side `drive:navigate` handler.
  useWorkspaceStore.getState().setPanePayload(target.tab.id, target.pane.id, {
    ...(target.pane.payload ?? {}),
    url,
  });
  return { ok: true, paneId: target.pane.id, url };
});

// ---- knowledge / kanban / teams / messages / terminal handlers -------------
//
// These mirror the in-app Super Agent tools in src/lib/superAgent/tools.ts.
// External MCP clients reach them via /mcp + round_trip in agent_api/mcp.rs.

function resolveProjectPath(payload: Record<string, unknown>): string | null {
  const explicit = payload.projectPath as string | undefined;
  if (explicit) return explicit;
  const { requesterPaneId, requesterTabId } = reqIds(payload);
  const tab = findRequesterTab(requesterPaneId, requesterTabId);
  if (tab?.projectPath) return tab.projectPath;
  const ws = useWorkspaceStore.getState();
  return ws.tabs.find((t) => t.projectPath)?.projectPath ?? null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function errString(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---- notes -----------------------------------------------------------------

registerAgentApiHandler("notes.save", async (payload) => {
  const projectPath = resolveProjectPath(payload);
  if (!projectPath) {
    return { ok: false, error: "no project context — pass projectPath or open a workspace tab" };
  }
  const title = payload.title as string | undefined;
  const body = payload.body as string | undefined;
  if (!title) return { ok: false, error: "missing title" };
  if (typeof body !== "string") return { ok: false, error: "missing body" };
  const slug = payload.slug as string | undefined;
  const tags = Array.isArray(payload.tags)
    ? (payload.tags as unknown[]).filter((t): t is string => typeof t === "string")
    : undefined;
  try {
    const note = await knowledgeWrite({ projectPath, title, body, slug, tags });
    const ks = useKnowledgeStore.getState();
    if (ks.activeProjectPath === projectPath) void ks.reload();
    return {
      ok: true,
      slug: note.slug,
      title: note.title,
      path: `${projectPath}/.anyspace/knowledge/${note.slug}.md`,
      backlinks: note.backlinks.length,
      outbound: note.outbound.length,
    };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("notes.get", async (payload) => {
  const projectPath = resolveProjectPath(payload);
  if (!projectPath) return { ok: false, error: "no project context" };
  const slug = payload.slug as string | undefined;
  if (!slug) return { ok: false, error: "missing slug" };
  try {
    const note = await knowledgeRead(projectPath, slug);
    return { ok: true, note };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("notes.list", async (payload) => {
  const projectPath = resolveProjectPath(payload);
  if (!projectPath) return { ok: false, error: "no project context" };
  const limit = (payload.limit as number | undefined) ?? 50;
  try {
    const notes = await knowledgeList(projectPath);
    return { ok: true, projectPath, total: notes.length, notes: notes.slice(0, limit) };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("notes.search", async (payload) => {
  const projectPath = resolveProjectPath(payload);
  if (!projectPath) return { ok: false, error: "no project context" };
  const query = payload.query as string | undefined;
  if (typeof query !== "string") return { ok: false, error: "missing query" };
  const limit = (payload.limit as number | undefined) ?? 20;
  try {
    const matches = await knowledgeSearch(projectPath, query, limit);
    return { ok: true, query, count: matches.length, matches };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("notes.find_backlinks", async (payload) => {
  const projectPath = resolveProjectPath(payload);
  if (!projectPath) return { ok: false, error: "no project context" };
  const slug = payload.slug as string | undefined;
  if (!slug) return { ok: false, error: "missing slug" };
  try {
    const note = await knowledgeRead(projectPath, slug);
    return { ok: true, slug, backlinks: note.backlinks };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("notes.link", async (payload) => {
  const projectPath = resolveProjectPath(payload);
  if (!projectPath) return { ok: false, error: "no project context" };
  const fromSlug = payload.fromSlug as string | undefined;
  const toSlug = payload.toSlug as string | undefined;
  if (!fromSlug || !toSlug) return { ok: false, error: "missing fromSlug or toSlug" };
  if (fromSlug === toSlug) return { ok: false, error: "fromSlug and toSlug must differ" };
  try {
    const [from, to] = await Promise.all([
      knowledgeRead(projectPath, fromSlug),
      knowledgeRead(projectPath, toSlug),
    ]);
    const slugRe = new RegExp(`\\[\\[\\s*${escapeRegex(to.slug)}\\s*\\]\\]`, "i");
    const titleRe = new RegExp(`\\[\\[\\s*${escapeRegex(to.title)}\\s*\\]\\]`, "i");
    if (slugRe.test(from.body) || titleRe.test(from.body)) {
      return { ok: true, alreadyLinked: true, fromSlug: from.slug, toSlug: to.slug };
    }
    const sep = from.body.endsWith("\n") ? "\n" : "\n\n";
    const updatedBody = from.body + sep + `See also: [[${to.title}]]\n`;
    const written = await knowledgeWrite({
      projectPath,
      title: from.title,
      body: updatedBody,
      slug: from.slug,
      tags: from.tags,
    });
    const ks = useKnowledgeStore.getState();
    if (ks.activeProjectPath === projectPath) void ks.reload();
    return {
      ok: true,
      alreadyLinked: false,
      fromSlug: written.slug,
      toSlug: to.slug,
      appended: `[[${to.title}]]`,
    };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

// ---- kanban ----------------------------------------------------------------

registerAgentApiHandler("kanban.list", async (payload) => {
  const column = payload.column as Task["column"] | undefined;
  const agentId = payload.agentId as string | undefined;
  const limit = payload.limit as number | undefined;
  const all = useKanbanStore.getState().tasks;
  let filtered = all;
  if (column) filtered = filtered.filter((t) => t.column === column);
  if (agentId) filtered = filtered.filter((t) => t.agentId === agentId);
  const tasks = typeof limit === "number" ? filtered.slice(0, limit) : filtered;
  return { ok: true, total: filtered.length, tasks };
});

registerAgentApiHandler("kanban.create", async (payload) => {
  const title = payload.title as string | undefined;
  if (!title) return { ok: false, error: "missing title" };
  try {
    const task = await useKanbanStore.getState().createTask({
      title,
      body: (payload.body as string | undefined) ?? "",
      agentId: payload.agentId as string | undefined,
      column: (payload.column as Task["column"] | undefined) ?? "todo",
      projectPath:
        (payload.projectPath as string | undefined) ??
        resolveProjectPath(payload) ??
        undefined,
    });
    return { ok: true, task };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("kanban.update", async (payload) => {
  const id = payload.id as string | undefined;
  if (!id) return { ok: false, error: "missing id" };
  const existing = useKanbanStore.getState().tasks.find((t) => t.id === id);
  if (!existing) return { ok: false, error: `task ${id} not found` };
  const patch: Partial<Task> = {};
  if (typeof payload.title === "string") patch.title = payload.title;
  if (typeof payload.body === "string") patch.body = payload.body;
  if (typeof payload.column === "string") patch.column = payload.column as Task["column"];
  if (payload.agentId === null) patch.agentId = undefined;
  else if (typeof payload.agentId === "string") patch.agentId = payload.agentId;
  try {
    await useKanbanStore.getState().updateTask(id, patch);
    const updated = useKanbanStore.getState().tasks.find((t) => t.id === id);
    return { ok: true, task: updated };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("kanban.move", async (payload) => {
  const id = payload.id as string | undefined;
  const column = payload.column as Task["column"] | undefined;
  if (!id) return { ok: false, error: "missing id" };
  if (!column) return { ok: false, error: "missing column" };
  const ordinal =
    typeof payload.ordinal === "number" ? (payload.ordinal as number) : Date.now();
  try {
    await useKanbanStore.getState().moveTask(id, column, ordinal);
    const updated = useKanbanStore.getState().tasks.find((t) => t.id === id);
    return { ok: true, task: updated };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

// ---- teams + messages ------------------------------------------------------

registerAgentApiHandler("teams.list", async (payload) => {
  const status = payload.status as "active" | "archived" | undefined;
  const ts = useTeamStore.getState();
  const teams = ts.teams
    .filter((t) => (status ? t.status === status : true))
    .map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
      projectPath: t.projectPath,
      goal: t.goal,
      tabId: t.tabId,
      agentCount: (ts.agents[t.id] ?? []).length,
    }));
  return { ok: true, total: teams.length, teams };
});

registerAgentApiHandler("messages.read", async (payload) => {
  const teamId = payload.teamId as string | undefined;
  if (!teamId) return { ok: false, error: "missing teamId" };
  const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: `team ${teamId} not found` };
  const sinceTs = payload.sinceTs as string | undefined;
  const fromFilter = payload.from as string | undefined;
  const toFilter = payload.to as string | undefined;
  const typeFilter = payload.type as string | undefined;
  const limit = (payload.limit as number | undefined) ?? 50;
  try {
    let content = "";
    try {
      content = await teamReadMessagesText(team.teamDir);
    } catch {
      /* file may not exist yet — empty log */
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
    return {
      ok: true,
      teamId,
      total: filtered.length,
      returned: sliced.length,
      truncated: filtered.length > sliced.length,
      messages: sliced,
    };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("messages.send", async (payload) => {
  const teamId = payload.teamId as string | undefined;
  const to = payload.to as string | undefined;
  const body = payload.body as string | undefined;
  const type = (payload.type as string | undefined) ?? "message";
  const from = (payload.from as string | undefined) ?? "External MCP";
  if (!teamId || !to || !body) {
    return { ok: false, error: "missing teamId / to / body" };
  }
  const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: `team ${teamId} not found` };
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const ts = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  try {
    // Goes through team_append_message — flock-coordinated with tmsg.sh and
    // not gated by the plugin-fs scope, so it works for projects outside
    // $HOME (e.g. /tmp/foo) too.
    const result = await teamAppendMessage({
      teamDir: team.teamDir,
      id,
      from,
      to,
      type,
      ts,
      body,
    });
    return { ok: true, id: result.id, ts: result.ts, teamId, to, path: result.path };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

// ---- terminal --------------------------------------------------------------

registerAgentApiHandler("terminal.read", async (payload) => {
  const paneId = payload.paneId as string | undefined;
  if (!paneId) return { ok: false, error: "missing paneId" };
  const lastN = payload.lastN as number | undefined;
  const screen = getTerminalScreen(paneId, lastN);
  if (!screen) return { ok: false, error: `pane ${paneId} has no live terminal` };
  const ctx = getTerminalContext(paneId);
  return {
    ok: true,
    paneId,
    screen: screen.screen,
    bufferType: screen.bufferType,
    lastBlockState: screen.lastBlockState,
    lastCommand: screen.lastCommand,
    lastExitCode: screen.lastExitCode,
    lastFinishedOutput: ctx ? ctx.output : null,
  };
});

registerAgentApiHandler("terminal.broadcast", async (payload) => {
  const teamId = payload.teamId as string | undefined;
  const text = payload.text as string | undefined;
  const withNewline = (payload.withNewline as boolean | undefined) ?? false;
  if (!teamId) return { ok: false, error: "missing teamId" };
  if (text == null) return { ok: false, error: "missing text" };
  const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: `team ${teamId} not found` };
  if (!team.tabId) return { ok: false, error: `team ${teamId} has no live tab` };
  try {
    const out = withNewline ? `${text}\n` : text;
    const result = await runSuperBrainTeamBroadcast(team.tabId, out);
    return { ok: true, teamId, ...result, submitted: withNewline };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});

registerAgentApiHandler("terminal.send_to_pane", async (payload) => {
  const teamId = payload.teamId as string | undefined;
  const text = payload.text as string | undefined;
  const withNewline = (payload.withNewline as boolean | undefined) ?? false;
  let paneId = payload.paneId as string | undefined;
  const label = payload.label as string | undefined;
  if (!teamId) return { ok: false, error: "missing teamId" };
  if (text == null) return { ok: false, error: "missing text" };
  const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
  if (!team) return { ok: false, error: `team ${teamId} not found` };
  if (!paneId && label) {
    const roster = useTeamStore.getState().agents[teamId] ?? [];
    const match = roster.find((a) => a.label === label);
    if (!match) return { ok: false, error: `label "${label}" not found in team roster` };
    if (!match.paneId) return { ok: false, error: `agent "${label}" has no live pane` };
    paneId = match.paneId;
  }
  if (!paneId) return { ok: false, error: "provide paneId or label" };
  const sid = getTerminalSessionId(paneId);
  if (!sid) return { ok: false, error: `pane ${paneId} has no live PTY session` };
  const out = withNewline ? `${text}\n` : text;
  try {
    await ptyWrite(sid, new TextEncoder().encode(out));
    return { ok: true, teamId, paneId, wroteBytes: out.length, submitted: withNewline };
  } catch (e) {
    return { ok: false, error: errString(e) };
  }
});
