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

/** Capture context from a single pane and return the sanitized + guarded
 *  next-command suggestion. Used both by the legacy ⌘⇧B keybind (write=true,
 *  default) and by the Super Agent's quick_suggest tool (write=false). */
export async function runQuickSuggest(opts: {
  paneId: string;
  write?: boolean;
}): Promise<string> {
  const ctx = getTerminalContext(opts.paneId);
  if (!ctx) throw new Error("no completed command block on that pane");
  const ai = useAiStore.getState().settings;
  if (!ai.endpoint || !ai.apiKey || !ai.model) {
    throw new Error("AI not configured (Settings → AI)");
  }
  const reply = await aiChat({
    endpoint: ai.endpoint,
    apiKey: ai.apiKey,
    model: ai.model,
    systemPrompt: SUPER_BRAIN_SYSTEM_PROMPT,
    userMessage: buildUserMessage(ctx),
  });
  const cmd = sanitize(reply);
  if (!cmd) throw new Error("model returned no usable command");
  const safe = guardDraft(cmd);
  if (opts.write !== false) {
    await ptyWrite(ctx.sessionId, new TextEncoder().encode(safe));
  }
  return safe;
}

export async function runSuperBrain(tabId: string): Promise<void> {
  console.log("[superBrain] invoked", { tabId });
  const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab) {
    console.warn("[superBrain] no tab found for id", tabId);
    return;
  }
  const sel = tab.selectedPaneIds ?? [];
  const targets = sel.length > 0 ? sel : (tab.activePaneId ? [tab.activePaneId] : []);
  console.log("[superBrain] targets resolved", {
    selectedPaneIds: sel,
    activePaneId: tab.activePaneId,
    targets,
  });
  if (targets.length === 0) {
    console.warn("[superBrain] no target panes — select a pane or focus a terminal first");
    return;
  }

  const ai = useAiStore.getState().settings;
  console.log("[superBrain] ai settings", {
    endpoint: ai.endpoint,
    model: ai.model,
    hasApiKey: !!ai.apiKey,
  });
  if (!ai.endpoint || !ai.apiKey || !ai.model) {
    console.warn("[superBrain] AI not configured — skipping", {
      hasEndpoint: !!ai.endpoint,
      hasApiKey: !!ai.apiKey,
      hasModel: !!ai.model,
    });
    return;
  }

  const results = await Promise.all(
    targets.map(async (paneId) => {
      const pane = tab.panes[paneId];
      if (!pane) {
        console.warn("[superBrain] pane missing in tab", { paneId });
        return "missing-pane";
      }
      if (pane.kind !== "terminal") {
        console.warn("[superBrain] skipping non-terminal pane", { paneId, kind: pane.kind });
        return "non-terminal";
      }
      const ctx = getTerminalContext(paneId);
      if (!ctx) {
        console.warn(
          "[superBrain] no completed command block for pane — run a command and wait for it to finish first",
          { paneId },
        );
        return "no-context";
      }
      console.log("[superBrain] context captured", {
        paneId,
        sessionId: ctx.sessionId,
        command: ctx.command,
        exitCode: ctx.exitCode,
        outputLength: ctx.output.length,
      });
      try {
        console.log("[superBrain] calling aiChat", { paneId, endpoint: ai.endpoint, model: ai.model });
        const reply = await aiChat({
          endpoint: ai.endpoint,
          apiKey: ai.apiKey,
          model: ai.model,
          systemPrompt: SUPER_BRAIN_SYSTEM_PROMPT,
          userMessage: buildUserMessage(ctx),
        });
        console.log("[superBrain] aiChat reply", { paneId, replyLength: reply.length, replyPreview: reply.slice(0, 200) });
        const cmd = sanitize(reply);
        if (!cmd) {
          console.warn("[superBrain] sanitize produced empty draft — model returned no usable command", { paneId, reply });
          return "empty-draft";
        }
        const safe = guardDraft(cmd);
        if (safe !== cmd) {
          console.log("[superBrain] draft guarded with comment prefix (destructive heuristic)", { paneId, cmd, safe });
        }
        console.log("[superBrain] writing draft to PTY (no newline)", { paneId, sessionId: ctx.sessionId, draft: safe });
        // Raw bytes, no newline — the user reviews before pressing Enter.
        await ptyWrite(ctx.sessionId, new TextEncoder().encode(safe));
        return "ok";
      } catch (e) {
        // Tauri rejects with a plain string from the Rust command; ensure it's
        // visible (some loggers stringify Error wrappers as "[object Object]").
        const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        console.error("[superBrain] failed for pane", paneId, "→", msg, "(raw)", e);
        return "error";
      }
    }),
  );
  console.log("[superBrain] done", { results });
}

/**
 * Team-mode helpers: write a free-form prompt into one or all team panes
 * without a trailing newline. The user reviews each draft and presses
 * Enter once — broadcastBytes() (when multi-select is active) fans Enter
 * to every selected pane in parallel.
 *
 * Unlike runSuperBrain(), no AI completion is involved here; the panel
 * writes the operator's text directly. Treat this as the human controller
 * "speaking through" the agents' shells.
 */
export async function runSuperBrainTeamBroadcast(
  tabId: string,
  prompt: string,
): Promise<{ written: number; skipped: number }> {
  const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab) return { written: 0, skipped: 0 };
  const text = prompt.trim();
  if (!text) return { written: 0, skipped: 0 };
  let written = 0;
  let skipped = 0;
  const bytes = new TextEncoder().encode(text);
  for (const pane of Object.values(tab.panes)) {
    if (pane.kind !== "terminal") continue;
    const ctx = getTerminalContext(pane.id);
    if (!ctx) {
      skipped++;
      continue;
    }
    try {
      await ptyWrite(ctx.sessionId, bytes);
      written++;
    } catch (e) {
      console.warn("[superBrain.teamBroadcast] failed for pane", pane.id, e);
      skipped++;
    }
  }
  return { written, skipped };
}

export async function runSuperBrainTeamAsk(
  paneId: string,
  prompt: string,
): Promise<boolean> {
  const text = prompt.trim();
  if (!text) return false;
  const ctx = getTerminalContext(paneId);
  if (!ctx) return false;
  try {
    await ptyWrite(ctx.sessionId, new TextEncoder().encode(text));
    return true;
  } catch (e) {
    console.warn("[superBrain.teamAsk] failed", e);
    return false;
  }
}
