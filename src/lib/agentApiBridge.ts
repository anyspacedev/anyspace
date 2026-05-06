import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { agentApiReply, type AgentApiRequestEvent } from "./tauri";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { driveIframe, getPreviewIframe } from "./previewDrive";
import { capturePreviewIframeRaw } from "./previewCapture";
import type { LayoutNode, Pane, Tab } from "./types";

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

function findRequesterTab(requesterPaneId?: string): Tab | undefined {
  const ws = useWorkspaceStore.getState();
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
): { tab: Tab; pane: Pane } | null {
  const ws = useWorkspaceStore.getState();
  if (targetPaneId) {
    for (const tab of ws.tabs) {
      const pane = tab.panes[targetPaneId];
      if (pane && pane.kind === "preview") return { tab, pane };
    }
  }
  const tab = findRequesterTab(requesterPaneId);
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

// ---- handlers --------------------------------------------------------------

registerAgentApiHandler("panes.list", async (payload) => {
  const tab = findRequesterTab(String(payload.requesterPaneId ?? "") || undefined);
  if (!tab) return { panes: [], tabId: null };
  const panes = Object.values(tab.panes).map((p) => ({
    id: p.id,
    kind: p.kind,
    title: (p.payload?.title as string | undefined) ?? null,
  }));
  return { tabId: tab.id, panes };
});

registerAgentApiHandler("preview.open", async (payload) => {
  const requesterPaneId = (payload.requesterPaneId as string | undefined) ?? undefined;
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
  const tab = findRequesterTab(requesterPaneId);

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

  if (!tab || !requesterPaneId) {
    // No anchor — open in a fresh tab.
    const tabId = ws.newTab(
      1,
      "Preview",
      [{ kind: "preview", url, projectPath } as never],
      projectPath,
    );
    const newTab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
    const paneId = newTab ? collectLeafIds(newTab.layout)[0] : "";
    return { ok: true, paneId, tabId, reused: false };
  }

  const before = new Set(collectLeafIds(tab.layout));
  ws.splitPane(tab.id, requesterPaneId, direction, {
    kind: "preview",
    url,
    projectPath,
  } as never);
  const after = useWorkspaceStore.getState().tabs.find((t) => t.id === tab.id);
  const newPaneId = after ? collectLeafIds(after.layout).find((id) => !before.has(id)) : undefined;
  return { ok: true, paneId: newPaneId, tabId: tab.id, reused: false };
});

registerAgentApiHandler("preview.screenshot", async (payload) => {
  const targetPaneId = (payload.targetPaneId as string | undefined) ?? undefined;
  const requesterPaneId = (payload.requesterPaneId as string | undefined) ?? undefined;
  const target = resolvePreviewPane(targetPaneId, requesterPaneId);
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
  const requesterPaneId = (payload.requesterPaneId as string | undefined) ?? undefined;
  const selector = String(payload.selector ?? "");
  if (!selector) return { ok: false, error: "selector required" };
  const target = resolvePreviewPane(targetPaneId, requesterPaneId);
  if (!target) return { ok: false, error: "no preview pane available" };
  const result = await driveIframe(target.pane.id, "drive:click", { selector });
  return result;
});

registerAgentApiHandler("preview.fill", async (payload) => {
  const targetPaneId = (payload.targetPaneId as string | undefined) ?? undefined;
  const requesterPaneId = (payload.requesterPaneId as string | undefined) ?? undefined;
  const selector = String(payload.selector ?? "");
  const value = payload.value == null ? "" : String(payload.value);
  const submit = !!payload.submit;
  if (!selector) return { ok: false, error: "selector required" };
  const target = resolvePreviewPane(targetPaneId, requesterPaneId);
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
  const requesterPaneId = (payload.requesterPaneId as string | undefined) ?? undefined;
  const url = (payload.url as string | undefined) ?? undefined;
  if (!url) return { ok: false, error: "url required" };
  const target = resolvePreviewPane(targetPaneId, requesterPaneId);
  if (!target) return { ok: false, error: "no preview pane available" };
  // Mutate payload — the iframe key includes url, so this remounts the iframe
  // with the new src. Avoids needing an iframe-side `drive:navigate` handler.
  useWorkspaceStore.getState().setPanePayload(target.tab.id, target.pane.id, {
    ...(target.pane.payload ?? {}),
    url,
  });
  return { ok: true, paneId: target.pane.id, url };
});
