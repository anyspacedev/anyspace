import { create } from "zustand";
import type { TeamMessage } from "../lib/teamMessages";

export type OperatorPing = {
  /** TeamMessage.id, used for dedupe + markRead */
  msgId: string;
  teamId: string;
  teamName: string;
  from: string;
  to: string;
  type: TeamMessage["type"];
  ts: string;
  body: string;
};

type State = {
  pings: OperatorPing[];
  /** Highest ts observed per team — used to dedupe across watcher fires. */
  lastSeenTs: Record<string, string>;

  addPings: (incoming: OperatorPing[]) => void;
  markAllRead: () => void;
  markRead: (msgId: string) => void;
  /** Reset stored ts for a team (used when team is removed/archived). */
  forgetTeam: (teamId: string) => void;
};

export const useOperatorInboxStore = create<State>((set) => ({
  pings: [],
  lastSeenTs: {},

  addPings: (incoming) => {
    if (incoming.length === 0) return;
    set((s) => {
      const seen = new Set(s.pings.map((p) => p.msgId));
      const fresh = incoming.filter((p) => !seen.has(p.msgId));
      if (fresh.length === 0) return s;
      const lastSeen = { ...s.lastSeenTs };
      for (const p of fresh) {
        if (!lastSeen[p.teamId] || p.ts > lastSeen[p.teamId]) {
          lastSeen[p.teamId] = p.ts;
        }
      }
      return { pings: [...s.pings, ...fresh], lastSeenTs: lastSeen };
    });
  },

  markAllRead: () => set({ pings: [] }),
  markRead: (msgId) =>
    set((s) => ({ pings: s.pings.filter((p) => p.msgId !== msgId) })),
  forgetTeam: (teamId) =>
    set((s) => {
      const next = { ...s.lastSeenTs };
      delete next[teamId];
      return {
        pings: s.pings.filter((p) => p.teamId !== teamId),
        lastSeenTs: next,
      };
    }),
}));
