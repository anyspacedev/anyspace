import { agentLaunch } from "./tauri";
import { useKanbanStore } from "../stores/kanbanStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { agentApiEnv, ensureAgentApi } from "./agentApi";
import type { LayoutNode, Task } from "./types";

export type LaunchAgentInput = {
  agentId: string;
  taskId?: string;
  taskTitle: string;
  taskBody: string;
  taskColumn?: Task["column"];
  cwd?: string;
} & (
  | { mode: "new-tab" }
  | {
      mode: "current-tab";
      tabId: string;
      splitFromPaneId: string;
      splitDirection?: "horizontal" | "vertical";
    }
);

/**
 * Resolve an agent, prepare its task file via the Rust agent_launch command,
 * and spawn a terminal pane that auto-runs the resulting command.
 *
 * Returns the workspace tabId the terminal landed in, or null if the agent
 * is missing.
 */
export async function launchAgent(input: LaunchAgentInput): Promise<string | null> {
  const agents = useKanbanStore.getState().agents;
  const agent = agents.find((a) => a.id === input.agentId);
  if (!agent) return null;

  // Make sure the loopback API is reachable before we promise the agent that
  // $TEAMSHIP_API_URL works. ensureAgentApi is cached, so this is a no-op
  // after the first call.
  await ensureAgentApi().catch(() => null);

  const plan = await agentLaunch({
    agentCommand: agent.command,
    taskId: input.taskId ?? "",
    taskTitle: input.taskTitle,
    taskBody: input.taskBody,
    taskColumn: input.taskColumn ?? "",
    systemPrompt: agent.systemPrompt,
    envJson: agent.envJson,
  });

  const ws = useWorkspaceStore.getState();
  const apiEnv = agentApiEnv();
  const baseEnv = { ...plan.env, ...apiEnv };

  if (input.mode === "new-tab") {
    const tabId = ws.newTab(
      1,
      input.taskTitle,
      [
        {
          kind: "terminal",
          pendingCommand: plan.command,
          spawnEnv: baseEnv,
          spawnCwd: input.cwd,
          title: input.taskTitle,
        },
      ],
      input.cwd,
    );
    stampPaneApiEnv(tabId, baseEnv);
    ws.setActiveTab(tabId);
    ws.setView("workspace");
    return tabId;
  }

  const tabBefore = ws.tabs.find((t) => t.id === input.tabId);
  const before = tabBefore ? new Set(collectLeafIds(tabBefore.layout)) : new Set<string>();
  ws.splitPane(input.tabId, input.splitFromPaneId, input.splitDirection ?? "horizontal", {
    kind: "terminal",
    pendingCommand: plan.command,
    spawnEnv: baseEnv,
    spawnCwd: input.cwd,
    title: input.taskTitle,
  });
  stampPaneApiEnv(input.tabId, baseEnv, before);
  ws.setActiveTab(input.tabId);
  ws.setView("workspace");
  return input.tabId;
}

function collectLeafIds(layout: LayoutNode): string[] {
  if (layout.type === "leaf") return [layout.paneId];
  return layout.children.flatMap(collectLeafIds);
}

/**
 * After newTab/splitPane, find the freshly-created terminal pane(s) and
 * patch TEAMSHIP_PANE_ID + TEAMSHIP_TAB_ID into their spawnEnv. React
 * batches state updates within an event handler, so this is observed by
 * Terminal.tsx the first time it mounts for the new pane.
 */
function stampPaneApiEnv(
  tabId: string,
  baseEnv: Record<string, string>,
  before?: Set<string>,
) {
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const leaves = collectLeafIds(tab.layout);
  const targets = before ? leaves.filter((id) => !before.has(id)) : leaves;
  for (const paneId of targets) {
    const pane = tab.panes[paneId];
    if (!pane || pane.kind !== "terminal") continue;
    const existingEnv = (pane.payload?.spawnEnv as Record<string, string> | undefined) ?? baseEnv;
    ws.setPanePayload(tabId, paneId, {
      ...(pane.payload ?? {}),
      spawnEnv: {
        ...existingEnv,
        TEAMSHIP_PANE_ID: paneId,
        TEAMSHIP_TAB_ID: tabId,
      },
    });
  }
}
