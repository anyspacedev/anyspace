import { useSuperAgentStore } from "../stores/superAgentStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import {
  useOperatorInboxStore,
  type OperatorPing,
} from "../stores/operatorInboxStore";
import { getPrompt } from "./promptOverrides";

/** Wrapper template for the system note that hands off the @operator inbox
 *  into Super Agent. `${COUNT}`, `${PLURAL}`, and `${LINES}` are substituted
 *  at handoff time. Customizable in Settings → Prompts. */
export const OPERATOR_INBOX_HANDOFF_DEFAULT =
  "[Inbox handoff — ${COUNT} unread @operator message${PLURAL}]\n" +
  "${LINES}\n\n" +
  "Use tmsg_send to reply, or read_team_messages for more context.";

function formatPing(p: OperatorPing): string {
  const ts = p.ts ? ` (${p.ts})` : "";
  const tag = p.type === "escalation" ? "ESCALATION" : "MESSAGE";
  return `• [${tag}] ${p.from} → ${p.to} in team "${p.teamName}"${ts}\n  team_id: ${p.teamId}\n  ${p.body.replace(/\n/g, "\n  ")}`;
}

/**
 * Open the Super Agent rail and hand off the current unread inbox as a
 * single system note. Marks all pings read. Creates a session if none is
 * active so the note has a place to land.
 *
 * Triggered by the StatusBar @operator badge.
 */
export async function handoffInboxToSuperAgent(): Promise<void> {
  const inbox = useOperatorInboxStore.getState();
  const pings = inbox.pings;
  if (pings.length === 0) return;

  const sa = useSuperAgentStore.getState();
  let sessionId = sa.activeSessionId;
  if (!sessionId || !sa.sessions.some((s) => s.id === sessionId)) {
    const session = await sa.createSession("Operator handoff");
    sessionId = session.id;
    sa.setActiveSession(sessionId);
  } else {
    await sa.loadMessages(sessionId);
  }

  const lines = pings
    .slice()
    .sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0))
    .map(formatPing)
    .join("\n");
  const content = getPrompt("operatorInboxHandoff", OPERATOR_INBOX_HANDOFF_DEFAULT)
    .replaceAll("${COUNT}", String(pings.length))
    .replaceAll("${PLURAL}", pings.length === 1 ? "" : "s")
    .replaceAll("${LINES}", lines);

  await sa.appendMessage({
    sessionId,
    role: "system",
    content,
  });

  inbox.markAllRead();
  sa.setPanelOpen(true);
  const ws = useWorkspaceStore.getState();
  if (ws.selectedView !== "workspace") {
    ws.setView("workspace");
  }
}
