/**
 * One-shot session-title auto-naming. Fires after the first complete
 * user → assistant exchange in a Super Agent session whose name is still
 * the default `Session <timestamp>` string. On any failure (no creds,
 * model error, empty reply, race with manual rename) it logs to console
 * and returns — the chat continues unaffected.
 */

import { piAiChat } from "../aiSuggest/piAiChat";
import { resolveAiCreds } from "../cloudCredentials";
import { useAiStore } from "../../stores/aiStore";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { getPrompt } from "../promptOverrides";

const LOG = "[superAgent:autoName]";
const DEFAULT_NAME_PATTERN = /^Session \S/;
const MAX_REPLY_PREFIX = 600;
const MAX_TITLE_LEN = 60;

export const SUPER_AGENT_AUTO_NAME_PROMPT_DEFAULT =
  "Summarize the user's request as a short session title. " +
  "Reply with only the title — 2 to 5 words, no quotes, no trailing punctuation.";

function sanitizeTitle(raw: string): string {
  const collapsed = raw.replace(/\s+/g, " ").trim();
  const unquoted = collapsed.replace(/^["'`]+|["'`]+$/g, "").trim();
  const noTrailingPunct = unquoted.replace(/[.!?,;:]+$/g, "").trim();
  return noTrailingPunct.slice(0, MAX_TITLE_LEN).trim();
}

export async function maybeAutoNameSession(sessionId: string): Promise<void> {
  try {
    const store = useSuperAgentStore.getState();
    const session = store.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (!DEFAULT_NAME_PATTERN.test(session.name)) return;

    const messages = store.messagesBySession[sessionId] ?? [];
    const userMsg = messages.find((m) => m.role === "user");
    const assistantMsg = messages.find(
      (m) => m.role === "assistant" && m.streaming !== true,
    );
    if (!userMsg || !assistantMsg) return;

    const userText = userMsg.content.trim();
    if (!userText) return;
    const assistantText = (assistantMsg.content ?? "").trim();
    const assistantPrefix = assistantText.slice(0, MAX_REPLY_PREFIX);

    const ai = useAiStore.getState().settings;
    const creds = await resolveAiCreds(ai.presetId, {
      endpoint: ai.endpoint,
      apiKey: ai.apiKey,
      model: ai.model,
    });
    if (!creds.ok) {
      console.warn(LOG, "no creds", creds.reason);
      return;
    }

    const userMessage =
      `User's first message:\n${userText}\n\n` +
      (assistantPrefix
        ? `Assistant reply (excerpt):\n${assistantPrefix}\n\n`
        : "") +
      "Return only the title.";

    const reply = await piAiChat({
      endpoint: creds.endpoint,
      apiKey: creds.apiKey,
      model: creds.model,
      systemPrompt: getPrompt("superAgentAutoName", SUPER_AGENT_AUTO_NAME_PROMPT_DEFAULT),
      userMessage,
    });
    const cleaned = sanitizeTitle(reply);
    if (!cleaned) {
      console.warn(LOG, "empty reply", { raw: reply });
      return;
    }

    const fresh = useSuperAgentStore
      .getState()
      .sessions.find((s) => s.id === sessionId);
    if (!fresh || !DEFAULT_NAME_PATTERN.test(fresh.name)) return;

    await useSuperAgentStore.getState().renameSession(sessionId, cleaned);
  } catch (err) {
    console.warn(LOG, "failed", err);
  }
}
