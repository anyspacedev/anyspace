// Super Brain: for each selected terminal pane, capture the latest
// command + output, ask the AI for the next command, and write the
// suggestion into the PTY without a trailing newline. The user reviews,
// then presses Enter once — the broadcast layer fans Enter to every
// selected pane and they all execute their tailored drafts in parallel.

import { useWorkspaceStore } from "../stores/workspaceStore";
import { useAiStore } from "../stores/aiStore";
import { ptyWrite } from "./tauri";
import { piAiChat } from "./aiSuggest/piAiChat";
import { getTerminalContext, type TerminalContext } from "../components/terminal/terminalRegistry";
import { toast } from "../stores/toastStore";
import { resolveAiCreds } from "./cloudCredentials";
import { openLoginGuide } from "../stores/loginGuideStore";

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
  const creds = await resolveAiCreds(ai.presetId, {
    endpoint: ai.endpoint,
    apiKey: ai.apiKey,
    model: ai.model,
  });
  if (!creds.ok) {
    if (creds.reason === "needs-signin" || creds.reason === "no-token") {
      openLoginGuide("ai-explain");
      throw new Error("Sign in to AnySpace Cloud first");
    }
    throw new Error("AI not configured (Settings → AI)");
  }
  const reply = await piAiChat({
    endpoint: creds.endpoint,
    apiKey: creds.apiKey,
    model: creds.model,
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

export type SuperBrainStatus =
  | "ok"
  | "no-tab"
  | "no-targets"
  | "ai-not-configured"
  | "needs-signin"
  | "missing-pane"
  | "non-terminal"
  | "no-context"
  | "empty-draft"
  | "error";

export type SuperBrainPaneResult = {
  paneId: string;
  status: SuperBrainStatus;
  /** Set when status === "error". */
  errorMessage?: string;
  /** True when guardDraft prefixed `# ` because the heuristic flagged it. */
  guarded?: boolean;
};

export type SuperBrainResult = {
  /** Top-level status when no per-pane work was attempted. "ok" if any pane was attempted. */
  status: SuperBrainStatus;
  results: SuperBrainPaneResult[];
};

export async function runSuperBrain(tabId: string): Promise<SuperBrainResult> {
  console.log("[superBrain] invoked", { tabId });
  const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
  if (!tab) {
    console.warn("[superBrain] no tab found for id", tabId);
    return { status: "no-tab", results: [] };
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
    return { status: "no-targets", results: [] };
  }

  const ai = useAiStore.getState().settings;
  console.log("[superBrain] ai settings", {
    presetId: ai.presetId,
    endpoint: ai.endpoint,
    model: ai.model,
    hasApiKey: !!ai.apiKey,
  });
  const creds = await resolveAiCreds(ai.presetId, {
    endpoint: ai.endpoint,
    apiKey: ai.apiKey,
    model: ai.model,
  });
  if (!creds.ok) {
    if (creds.reason === "needs-signin" || creds.reason === "no-token") {
      console.warn("[superBrain] sign-in required — opening Login Guide");
      openLoginGuide("ai-explain");
      return { status: "needs-signin", results: [] };
    }
    console.warn("[superBrain] AI not configured — skipping", { reason: creds.reason });
    return { status: "ai-not-configured", results: [] };
  }

  const results: SuperBrainPaneResult[] = await Promise.all(
    targets.map(async (paneId): Promise<SuperBrainPaneResult> => {
      const pane = tab.panes[paneId];
      if (!pane) {
        console.warn("[superBrain] pane missing in tab", { paneId });
        return { paneId, status: "missing-pane" };
      }
      if (pane.kind !== "terminal") {
        console.warn("[superBrain] skipping non-terminal pane", { paneId, kind: pane.kind });
        return { paneId, status: "non-terminal" };
      }
      const ctx = getTerminalContext(paneId);
      if (!ctx) {
        console.warn(
          "[superBrain] no completed command block for pane — run a command and wait for it to finish first",
          { paneId },
        );
        return { paneId, status: "no-context" };
      }
      console.log("[superBrain] context captured", {
        paneId,
        sessionId: ctx.sessionId,
        command: ctx.command,
        exitCode: ctx.exitCode,
        outputLength: ctx.output.length,
      });
      try {
        console.log("[superBrain] calling aiChat", { paneId, endpoint: creds.endpoint, model: creds.model });
        const reply = await piAiChat({
          endpoint: creds.endpoint,
          apiKey: creds.apiKey,
          model: creds.model,
          systemPrompt: SUPER_BRAIN_SYSTEM_PROMPT,
          userMessage: buildUserMessage(ctx),
        });
        console.log("[superBrain] aiChat reply", { paneId, replyLength: reply.length, replyPreview: reply.slice(0, 200) });
        const cmd = sanitize(reply);
        if (!cmd) {
          console.warn("[superBrain] sanitize produced empty draft — model returned no usable command", { paneId, reply });
          return { paneId, status: "empty-draft" };
        }
        const safe = guardDraft(cmd);
        const guarded = safe !== cmd;
        if (guarded) {
          console.log("[superBrain] draft guarded with comment prefix (destructive heuristic)", { paneId, cmd, safe });
        }
        console.log("[superBrain] writing draft to PTY (no newline)", { paneId, sessionId: ctx.sessionId, draft: safe });
        // Raw bytes, no newline — the user reviews before pressing Enter.
        await ptyWrite(ctx.sessionId, new TextEncoder().encode(safe));
        return { paneId, status: "ok", guarded };
      } catch (e) {
        const msg = e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e);
        console.error("[superBrain] failed for pane", paneId, "→", msg, "(raw)", e);
        return { paneId, status: "error", errorMessage: msg };
      }
    }),
  );
  console.log("[superBrain] done", { results });
  return { status: "ok", results };
}

/**
 * Toast a user-facing summary of a SuperBrainResult. Caller-side helper so
 * non-UI callers (Super Agent tools, Run Task flows) can decide whether they
 * want their own surface; the keybind + pane-header button use this.
 *
 * On success with no guarded drafts: silent (the new text in the PTY *is* the
 * feedback). Mixed / failed states show one toast describing what happened.
 */
export function toastSuperBrainResult(result: SuperBrainResult): void {
  const openSettings = () =>
    useWorkspaceStore.getState().setView("settings");

  if (result.status === "no-tab") return; // not a user-actionable error
  if (result.status === "needs-signin") return; // Login Guide modal handles it
  if (result.status === "no-targets") {
    toast.warn(
      "Suggest with AI: no target pane",
      "Focus a terminal pane (or Cmd-click multiple) and try again.",
    );
    return;
  }
  if (result.status === "ai-not-configured") {
    toast.error(
      "AI provider not configured",
      "Set endpoint, API key, and model in Settings → AI.",
      { label: "Open Settings", onClick: openSettings },
    );
    return;
  }

  const counts = result.results.reduce(
    (acc, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<SuperBrainStatus, number>,
  );
  const ok = counts.ok ?? 0;
  const guarded = result.results.filter((r) => r.guarded).length;
  const noContext = counts["no-context"] ?? 0;
  const empty = counts["empty-draft"] ?? 0;
  const errored = counts.error ?? 0;
  const total = result.results.length;

  if (ok === total && guarded === 0) {
    // Silent success — the command in the PTY is the feedback.
    return;
  }
  if (ok === total && guarded > 0) {
    toast.warn(
      `Drafted with \`#\` prefix (${guarded === 1 ? "looks destructive" : `${guarded} look destructive`})`,
      "Edit the line and remove the leading `#` to run.",
    );
    return;
  }
  if (ok === 0 && noContext === total) {
    toast.warn(
      "No completed command yet",
      "Run a command in the selected pane and wait for it to finish, then try again.",
    );
    return;
  }
  if (ok === 0 && empty === total) {
    toast.warn(
      "AI didn't return a usable command",
      "Try again, or rephrase by running a more descriptive command first.",
    );
    return;
  }
  if (ok === 0 && errored === total) {
    const sample = result.results.find((r) => r.status === "error")?.errorMessage;
    toast.error(
      "Suggest with AI failed",
      sample ?? "See devtools console for details.",
    );
    return;
  }
  // Mixed.
  const skipped = total - ok;
  toast.info(
    `Drafted in ${ok} pane${ok === 1 ? "" : "s"}; skipped ${skipped}`,
    [
      noContext ? `${noContext} had no completed command` : "",
      empty ? `${empty} returned no draft` : "",
      errored ? `${errored} errored` : "",
      guarded ? `${guarded} drafted with \`#\` prefix` : "",
    ]
      .filter(Boolean)
      .join(" · "),
  );
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
