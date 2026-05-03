import { useSuperAgentStore } from "../stores/superAgentStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import {
  useOperatorInboxStore,
  type OperatorPing,
} from "../stores/operatorInboxStore";

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
  const content =
    `[Inbox handoff — ${pings.length} unread @operator message${
      pings.length === 1 ? "" : "s"
    }]\n${lines}\n\nUse tmsg_send to reply, or read_team_messages for more context.`;

  await sa.appendMessage({
    sessionId,
    role: "system",
    content,
  });

  inbox.markAllRead();
  sa.setPanelOpen(true);
  // Keep the user on the workspace view (rail mode) so they don't lose the
  // panes they were watching. If they were on a non-workspace view, switch
  // to workspace so the rail is actually visible.
  const ws = useWorkspaceStore.getState();
  if (ws.selectedView !== "workspace" && ws.selectedView !== "superagent") {
    ws.setView("workspace");
  }
}
