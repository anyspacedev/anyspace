// Super Brain: for each selected terminal pane, capture the latest
// command + output, ask the AI for the next command, and write the
// suggestion into the PTY without a trailing newline. The user reviews,
// then presses Enter once — the broadcast layer fans Enter to every
// selected pane and they all execute their tailored drafts in parallel.

import { useWorkspaceStore } from "../stores/workspaceStore";
import { useAiStore } from "../stores/aiStore";
import { aiChat, ptyWrite } from "./tauri";
import { getTerminalContext, type TerminalContext } from "../components/terminal/terminalRegistry";

const SUPER_BRAIN_SYSTEM_PROMPT =
  "You are a paired engineer driving a terminal. Given the user's last " +
  "command and its output, propose the single next shell command to run. " +
  "Output the command alone — one line, no explanation, no markdown fences, " +
  "no leading $.";

function buildUserMessage(ctx: TerminalContext): string {
  const exit = ctx.exitCode != null ? `\nexit ${ctx.exitCode}` : "";
  return `Last command:\n$ ${ctx.command}\n\nOutput:\n${ctx.output}${exit}\n\nWhat should I run next?`;
}

// Strip code fences, leading prompt characters, and anything after the first
// newline. We never want the AI to trick us into auto-executing — the user
// must press Enter themselves.
function sanitize(reply: string): string {
  let s = reply.trim();
  // Drop ```lang fences.
  s = s.replace(/^```[a-zA-Z0-9_-]*\s*/m, "").replace(/```\s*$/m, "");
  // Take first non-empty line.
  const line = s.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
  if (!line) return "";
  // Strip a leading "$ " or "> " if the model added one.
  return line.replace(/^[$>#]\s+/, "");
}

// Heuristics for "the user almost certainly did not intend to fire this on
// blind Enter." Comment-prefixed drafts force the user to edit before they
// can execute. False positives are cheap (just delete the "# "); false
// negatives are dangerous on a broadcast group.
const DESTRUCTIVE = /^(sudo\b|rm\b|kubectl\s+delete\b|drop\s+(database|table)\b|truncate\b|dd\s+if=)/i;
function guardDraft(cmd: string): string {
  return DESTRUCTIVE.test(cmd) ? `# ${cmd}` : cmd;
}

export async function runSuperBrain(tabId: string): Promise<void> {
  const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return;
  const sel = tab.selectedPaneIds ?? [];
  const targets = sel.length > 0 ? sel : (tab.activePaneId ? [tab.activePaneId] : []);
  if (targets.length === 0) return;

  const ai = useAiStore.getState().settings;
  if (!ai.endpoint || !ai.apiKey || !ai.model) {
    console.warn("[superBrain] AI not configured — skipping");
    return;
  }

  await Promise.all(
    targets.map(async (paneId) => {
      const pane = tab.panes[paneId];
      if (!pane || pane.kind !== "terminal") return;
      const ctx = getTerminalContext(paneId);
      if (!ctx) return;
      try {
        const reply = await aiChat({
          endpoint: ai.endpoint,
          apiKey: ai.apiKey,
          model: ai.model,
          systemPrompt: SUPER_BRAIN_SYSTEM_PROMPT,
          userMessage: buildUserMessage(ctx),
        });
        const cmd = sanitize(reply);
        if (!cmd) return;
        const safe = guardDraft(cmd);
        // Raw bytes, no newline — the user reviews before pressing Enter.
        await ptyWrite(ctx.sessionId, new TextEncoder().encode(safe));
      } catch (e) {
        console.warn("[superBrain] failed for pane", paneId, e);
      }
    }),
  );
}
