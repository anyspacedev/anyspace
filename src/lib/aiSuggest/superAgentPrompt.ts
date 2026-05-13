import { runAiSuggest } from "./runner";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { getTerminalContext, getTerminalScreen } from "../../components/terminal/terminalRegistry";
import { getPrompt } from "../promptOverrides";

export type SuggestedPrompt = {
  prompt: string;
};

export const AI_SUGGEST_SUPER_AGENT_PROMPT_DEFAULT = `You draft a short, concrete first message for a coding-assistant chat that already has access to the user's workspace.

OUTPUT FORMAT (strict): a single JSON object — no markdown fences, no preamble, no trailing text.
{
  "prompt": string (the user-facing message to seed the chat — 1-3 sentences, ends with a clear ask)
}

CONSTRAINTS:
- Use the provided pane context to make the prompt SPECIFIC. Reference the file, last command, or URL by name when present.
- If the last command failed (non-zero exit), draft a "fix the failure" message.
- If the active pane is an editor, draft a message about the open file.
- If nothing useful is in context, draft a generic "summarize what's in this workspace and propose a next step" message.
- Avoid markdown formatting in "prompt".
- Output the JSON object alone. Any extra text breaks the consumer.`;

type ActivePaneSummary = {
  kind: string;
  paneId?: string;
  /** Truthy when this is a terminal with a finished command. */
  lastCommand?: string;
  lastOutputTail?: string;
  lastExitCode?: number | null;
  /** Truthy when this is an editor / preview. Free-form blob. */
  payloadHint?: Record<string, unknown>;
  /** Visible terminal screen tail when no completed command block exists. */
  screenTail?: string;
};

function gatherActivePane(): ActivePaneSummary | null {
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (!tab) return null;
  const paneId = tab.activePaneId;
  if (!paneId) return null;
  const pane = tab.panes[paneId];
  if (!pane) return null;

  if (pane.kind === "terminal") {
    const ctx = getTerminalContext(paneId);
    if (ctx) {
      return {
        kind: "terminal",
        paneId,
        lastCommand: ctx.command,
        lastOutputTail: ctx.output.split("\n").slice(-40).join("\n"),
        lastExitCode: ctx.exitCode ?? null,
      };
    }
    const screen = getTerminalScreen(paneId);
    if (screen) {
      return {
        kind: "terminal",
        paneId,
        screenTail: screen.screen.split("\n").slice(-40).join("\n"),
      };
    }
    return { kind: "terminal", paneId };
  }

  return {
    kind: pane.kind,
    paneId,
    payloadHint: pane.payload as Record<string, unknown> | undefined,
  };
}

export async function suggestSuperAgentPrompt(): Promise<SuggestedPrompt> {
  const activePane = gatherActivePane();
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeTabId);

  return runAiSuggest({
    surface: "super-agent-prompt",
    systemPrompt: getPrompt("aiSuggestSuperAgent", AI_SUGGEST_SUPER_AGENT_PROMPT_DEFAULT),
    context: {
      tabName: tab?.name,
      projectPath: tab?.projectPath,
      paneCount: tab ? Object.keys(tab.panes).length : 0,
      activePane,
    },
    parse: (obj) => {
      if (!obj || typeof obj !== "object") throw new Error("AI response was not an object");
      const o = obj as Record<string, unknown>;
      const prompt = typeof o.prompt === "string" ? o.prompt.trim() : "";
      if (!prompt) throw new Error("AI returned an empty prompt");
      return { prompt };
    },
  });
}
