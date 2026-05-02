import { create } from "zustand";
import Database from "@tauri-apps/plugin-sql";
import { teamWatchStop } from "../lib/tauri";
import type { TeamRole } from "../lib/teamRoles";

let dbPromise: Promise<Database> | null = null;
function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:teamship.db");
  }
  return dbPromise;
}

const newId = () => Math.random().toString(36).slice(2, 12);
const now = () => Date.now();

export type TeamStatus = "active" | "archived";

export type Team = {
  id: string;
  name: string;
  projectPath: string;
  goal: string;
  status: TeamStatus;
  tabId?: string;
  teamDir: string;
  createdAt: number;
  updatedAt: number;
};

export type TeamAgent = {
  id: string;
  teamId: string;
  paneId?: string;
  label: string;
  role: TeamRole;
  agentId: string;
  systemPromptOverride?: string;
  ordinal: number;
};

export type TeamAttachment = {
  id: string;
  teamId: string;
  path: string;
  kind: string;
  createdAt: number;
};

export type TeamSkillRow = { teamId: string; skillId: string };

export type TeamCreateInput = {
  name: string;
  projectPath: string;
  goal: string;
  agents: { label: string; role: TeamRole; agentId: string; systemPromptOverride?: string }[];
  skillIds: string[];
  attachments: { path: string; kind?: string }[];
};

type Row = Record<string, unknown>;

const rowToTeam = (r: Row): Team => ({
  id: String(r.id),
  name: String(r.name),
  projectPath: String(r.project_path),
  goal: String(r.goal ?? ""),
  status: (r.status as TeamStatus) ?? "active",
  tabId: r.tab_id ? String(r.tab_id) : undefined,
  teamDir: String(r.team_dir),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const rowToAgent = (r: Row): TeamAgent => ({
  id: String(r.id),
  teamId: String(r.team_id),
  paneId: r.pane_id ? String(r.pane_id) : undefined,
  label: String(r.label),
  role: r.role as TeamRole,
  agentId: String(r.agent_id),
  systemPromptOverride: r.system_prompt_override ? String(r.system_prompt_override) : undefined,
  ordinal: Number(r.ordinal),
});

const rowToAttachment = (r: Row): TeamAttachment => ({
  id: String(r.id),
  teamId: String(r.team_id),
  path: String(r.path),
  kind: String(r.kind ?? "file"),
  createdAt: Number(r.created_at),
});

type TeamState = {
  loaded: boolean;
  teams: Team[];
  agents: Record<string, TeamAgent[]>;
  skills: Record<string, string[]>;
  attachments: Record<string, TeamAttachment[]>;
  load: () => Promise<void>;
  create: (input: TeamCreateInput) => Promise<{ team: Team; agents: TeamAgent[] }>;
  setTabId: (teamId: string, tabId: string | undefined) => Promise<void>;
  setPaneId: (teamAgentId: string, paneId: string | undefined) => Promise<void>;
  archive: (teamId: string) => Promise<void>;
};

export const useTeamStore = create<TeamState>((set) => ({
  loaded: false,
  teams: [],
  agents: {},
  skills: {},
  attachments: {},

  load: async () => {
    const db = await getDb();
    const teamRows = await db.select<Row[]>(
      "SELECT * FROM teams ORDER BY updated_at DESC",
    );
    const agentRows = await db.select<Row[]>(
      "SELECT * FROM team_agents ORDER BY team_id, ordinal",
    );
    const skillRows = await db.select<Row[]>("SELECT * FROM team_skills");
    const attachmentRows = await db.select<Row[]>(
      "SELECT * FROM team_attachments ORDER BY team_id, created_at",
    );

    const agents: Record<string, TeamAgent[]> = {};
    for (const row of agentRows) {
      const a = rowToAgent(row);
      (agents[a.teamId] ??= []).push(a);
    }
    const skills: Record<string, string[]> = {};
    for (const row of skillRows) {
      const tid = String(row.team_id);
      const sid = String(row.skill_id);
      (skills[tid] ??= []).push(sid);
    }
    const attachments: Record<string, TeamAttachment[]> = {};
    for (const row of attachmentRows) {
      const a = rowToAttachment(row);
      (attachments[a.teamId] ??= []).push(a);
    }

    set({
      teams: teamRows.map(rowToTeam),
      agents,
      skills,
      attachments,
      loaded: true,
    });
  },

  create: async (input) => {
    const db = await getDb();
    const ts = now();
    const team: Team = {
      id: newId(),
      name: input.name,
      projectPath: input.projectPath,
      goal: input.goal,
      status: "active",
      teamDir: "",
      createdAt: ts,
      updatedAt: ts,
    };
    // team_dir is stored later (after team_init), but the column is NOT NULL; seed
    // with the conventional path so the row is valid even if we crash before init.
    const seededDir = `${input.projectPath.replace(/\/$/, "")}/.teamship/teams/${team.id}`;
    team.teamDir = seededDir;

    await db.execute(
      "INSERT INTO teams (id, name, project_path, goal, status, tab_id, team_dir, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        team.id,
        team.name,
        team.projectPath,
        team.goal,
        team.status,
        null,
        team.teamDir,
        team.createdAt,
        team.updatedAt,
      ],
    );

    const agents: TeamAgent[] = [];
    for (let i = 0; i < input.agents.length; i++) {
      const seed = input.agents[i];
      const ta: TeamAgent = {
        id: newId(),
        teamId: team.id,
        label: seed.label,
        role: seed.role,
        agentId: seed.agentId,
        systemPromptOverride: seed.systemPromptOverride,
        ordinal: i,
      };
      await db.execute(
        "INSERT INTO team_agents (id, team_id, pane_id, label, role, agent_id, system_prompt_override, ordinal) VALUES (?,?,?,?,?,?,?,?)",
        [ta.id, ta.teamId, null, ta.label, ta.role, ta.agentId, ta.systemPromptOverride ?? null, ta.ordinal],
      );
      agents.push(ta);
    }

    for (const sid of input.skillIds) {
      await db.execute(
        "INSERT OR IGNORE INTO team_skills (team_id, skill_id) VALUES (?,?)",
        [team.id, sid],
      );
    }
    const attachments: TeamAttachment[] = [];
    for (const att of input.attachments) {
      const a: TeamAttachment = {
        id: newId(),
        teamId: team.id,
        path: att.path,
        kind: att.kind ?? "file",
        createdAt: now(),
      };
      await db.execute(
        "INSERT INTO team_attachments (id, team_id, path, kind, created_at) VALUES (?,?,?,?,?)",
        [a.id, a.teamId, a.path, a.kind, a.createdAt],
      );
      attachments.push(a);
    }

    set((s) => ({
      teams: [team, ...s.teams],
      agents: { ...s.agents, [team.id]: agents },
      skills: { ...s.skills, [team.id]: [...input.skillIds] },
      attachments: { ...s.attachments, [team.id]: attachments },
    }));
    return { team, agents };
  },

  setTabId: async (teamId, tabId) => {
    const db = await getDb();
    await db.execute("UPDATE teams SET tab_id=?, updated_at=? WHERE id=?", [
      tabId ?? null,
      now(),
      teamId,
    ]);
    set((s) => ({
      teams: s.teams.map((t) => (t.id === teamId ? { ...t, tabId, updatedAt: now() } : t)),
    }));
  },

  setPaneId: async (teamAgentId, paneId) => {
    const db = await getDb();
    await db.execute("UPDATE team_agents SET pane_id=? WHERE id=?", [paneId ?? null, teamAgentId]);
    set((s) => {
      const next: Record<string, TeamAgent[]> = { ...s.agents };
      for (const [tid, list] of Object.entries(s.agents)) {
        next[tid] = list.map((a) => (a.id === teamAgentId ? { ...a, paneId } : a));
      }
      return { agents: next };
    });
  },

  archive: async (teamId) => {
    const db = await getDb();
    await db.execute("UPDATE teams SET status='archived', updated_at=? WHERE id=?", [now(), teamId]);
    try {
      await teamWatchStop(teamId);
    } catch {
      /* watcher may not be running */
    }
    set((s) => ({
      teams: s.teams.map((t) =>
        t.id === teamId ? { ...t, status: "archived", updatedAt: now() } : t,
      ),
    }));
  },
}));

export function getTeamForTab(tabId: string): Team | undefined {
  return useTeamStore.getState().teams.find((t) => t.tabId === tabId);
}

export function getTeamAgentByPane(paneId: string): { team: Team; agent: TeamAgent } | undefined {
  const state = useTeamStore.getState();
  for (const team of state.teams) {
    const list = state.agents[team.id] ?? [];
    const a = list.find((x) => x.paneId === paneId);
    if (a) return { team, agent: a };
  }
  return undefined;
}
