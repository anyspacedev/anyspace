import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { parseMessages, type TeamMessage } from "./teamMessages";
import { teamCompactMessages } from "./tauri";
import {
  useOperatorInboxStore,
  type OperatorPing,
} from "../stores/operatorInboxStore";
import { useTeamStore } from "../stores/teamStore";
import { toast } from "../stores/toastStore";
import { handoffInboxToSuperAgent } from "./operatorInboxHandoff";

type TeamMessagesEvent = { teamId: string; messagesPath: string };

const subscriptions = new Map<string, UnlistenFn>();

/** MESSAGES.md auto-compaction (formerly triggered from TeamChatPanel). */
const COMPACT_THRESHOLD = 500;
const COMPACT_KEEP = 250;
const COMPACT_DEBOUNCE_MS = 60_000;
const lastCompactAt = new Map<string, number>();

function maybeCompact(teamId: string, teamDir: string, teamName: string, blockCount: number): void {
  if (blockCount < COMPACT_THRESHOLD) return;
  const last = lastCompactAt.get(teamId) ?? 0;
  const now = Date.now();
  if (now - last < COMPACT_DEBOUNCE_MS) return;
  lastCompactAt.set(teamId, now);
  void teamCompactMessages({
    teamDir,
    maxEntries: COMPACT_THRESHOLD,
    keepRecent: COMPACT_KEEP,
  })
    .then((r) => {
      if (r.archived > 0) {
        console.log("[operatorInbox] compacted", teamId, r);
        toast.info(
          `Archived ${r.archived} old messages`,
          `Team "${teamName}" — older messages moved to MESSAGES.archive.md to keep the active log focused.`,
        );
      }
    })
    .catch((e) => console.warn("[operatorInbox] compact failed", teamId, e));
}

function isOperatorPing(m: TeamMessage): boolean {
  return m.to === "@operator" || m.type === "escalation";
}

async function refreshFor(teamId: string, teamDir: string, teamName: string): Promise<void> {
  const lastSeen = useOperatorInboxStore.getState().lastSeenTs[teamId];
  let content = "";
  try {
    content = await readTextFile(`${teamDir}/MESSAGES.md`);
  } catch {
    // file may not exist yet
    return;
  }
  const all = parseMessages(content);
  maybeCompact(teamId, teamDir, teamName, all.length);
  const fresh: OperatorPing[] = [];
  for (const m of all) {
    if (!isOperatorPing(m)) continue;
    if (lastSeen && m.ts <= lastSeen) continue;
    fresh.push({
      msgId: m.id,
      teamId,
      teamName,
      from: m.from,
      to: m.to,
      type: m.type,
      ts: m.ts,
      body: m.body,
    });
  }
  if (fresh.length > 0) {
    useOperatorInboxStore.getState().addPings(fresh);
    // Initial drain (when lastSeen is unset) means the user just opened the
    // app and these pings might have been waiting for hours — surface a
    // toast for *new* pings only (after we already had a baseline).
    if (lastSeen) {
      const newest = fresh[fresh.length - 1];
      const escalations = fresh.filter((p) => p.type === "escalation").length;
      const tone = escalations > 0 ? "error" : "warn";
      const title =
        escalations > 0
          ? `${escalations} escalation${escalations === 1 ? "" : "s"} from team "${teamName}"`
          : `${fresh.length} @operator message${fresh.length === 1 ? "" : "s"} from "${teamName}"`;
      const preview = newest.body.split("\n")[0]?.slice(0, 120);
      toast[tone](title, preview, {
        label: "Open Super Agent",
        onClick: () => {
          void handoffInboxToSuperAgent().catch((e) =>
            console.warn("[operatorInbox] handoff failed", e),
          );
        },
      });
    }
  } else if (!lastSeen && all.length > 0) {
    // No operator pings but file has content — seed lastSeen so future
    // pings are correctly bounded against this baseline.
    const newest = all[all.length - 1].ts;
    useOperatorInboxStore.setState((s) => ({
      lastSeenTs: { ...s.lastSeenTs, [teamId]: newest },
    }));
  }
}

/**
 * Subscribe to a team's MESSAGES.md watcher and surface @operator + escalation
 * messages as inbox pings. Idempotent — re-subscribing replaces the listener.
 *
 * On first subscribe we drain existing pings so escalations that happened
 * while the app was closed are still visible. Subsequent fires only add
 * messages with ts > lastSeenTs[teamId].
 */
export async function subscribeOperatorInbox(
  teamId: string,
  teamDir: string,
  teamName: string,
): Promise<UnlistenFn> {
  const existing = subscriptions.get(teamId);
  if (existing) {
    existing();
    subscriptions.delete(teamId);
  }
  const unlisten = await listen<TeamMessagesEvent>(
    `team:messages:${teamId}`,
    () => {
      void refreshFor(teamId, teamDir, teamName).catch((e) =>
        console.warn("[operatorInbox] refresh failed", teamId, e),
      );
    },
  );
  // Initial drain (catches anything that arrived while app was closed).
  await refreshFor(teamId, teamDir, teamName);
  subscriptions.set(teamId, unlisten);
  return () => {
    unlisten();
    subscriptions.delete(teamId);
  };
}

export function unsubscribeOperatorInbox(teamId: string): void {
  const fn = subscriptions.get(teamId);
  if (fn) {
    fn();
    subscriptions.delete(teamId);
  }
  lastCompactAt.delete(teamId);
  useOperatorInboxStore.getState().forgetTeam(teamId);
}

/**
 * Given the current teams list, sync subscriptions: subscribe new active teams,
 * unsubscribe teams that disappeared or got archived. Safe to call repeatedly.
 */
export async function syncOperatorInboxSubscriptions(): Promise<void> {
  const teams = useTeamStore.getState().teams;
  const wanted = new Set<string>();
  for (const team of teams) {
    if (team.status !== "active" || !team.tabId) continue;
    wanted.add(team.id);
    if (!subscriptions.has(team.id)) {
      try {
        await subscribeOperatorInbox(team.id, team.teamDir, team.name);
      } catch (e) {
        console.warn("[operatorInbox] subscribe failed", team.id, e);
      }
    }
  }
  for (const teamId of Array.from(subscriptions.keys())) {
    if (!wanted.has(teamId)) {
      unsubscribeOperatorInbox(teamId);
    }
  }
}
