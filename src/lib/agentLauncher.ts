import { agentLaunch } from "./tauri";
import { useKanbanStore } from "../stores/kanbanStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import type { Task } from "./types";

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
  if (input.mode === "new-tab") {
    const tabId = ws.newTab(1, input.taskTitle, [
      {
        kind: "terminal",
        pendingCommand: plan.command,
        spawnEnv: plan.env,
        spawnCwd: input.cwd,
        title: input.taskTitle,
      },
    ]);
    ws.setActiveTab(tabId);
    ws.setView("workspace");
    return tabId;
  }

  ws.splitPane(input.tabId, input.splitFromPaneId, input.splitDirection ?? "horizontal", {
    kind: "terminal",
    pendingCommand: plan.command,
    spawnEnv: plan.env,
    spawnCwd: input.cwd,
    title: input.taskTitle,
  });
  ws.setActiveTab(input.tabId);
  ws.setView("workspace");
  return input.tabId;
}
