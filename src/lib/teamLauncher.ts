import { agentLaunch, teamInit, teamWatchStart, teamWritePrompt } from "./tauri";
import { useKanbanStore } from "../stores/kanbanStore";
import { useWorkspaceStore, type PanePreset } from "../stores/workspaceStore";
import { useTeamStore, type Team, type TeamAgent } from "../stores/teamStore";
import { useTeamSettingsStore } from "../stores/teamSettingsStore";
import {
  renderRolePrompt,
  roleLabel,
  type TeamCustomRole,
  type TeamRole,
} from "./teamRoles";
import { renderSkillsMarkdown, type TeamSkill } from "./teamSkills";
import { subscribeTeamRpc } from "./teamRpc";
import { agentApiEnv, ensureAgentApi } from "./agentApi";

export type LaunchTeamOptions = {
  customSkills?: TeamSkill[];
  customRoles?: TeamCustomRole[];
  /** When true, skip pty respawn — used during resume to re-derive state without
   *  re-creating the tab. (Reserved for future use; currently always launches a tab.) */
  skipNewTab?: boolean;
};

export type LaunchTeamResult = {
  tabId: string;
  paneIdsByLabel: Record<string, string>;
};

function rosterMarkdown(_team: Team, agents: TeamAgent[], customRoles: TeamCustomRole[] = []): string {
  return agents
    .map((a) => `- **${a.label}** — ${roleLabel(a.role, customRoles)}`)
    .join("\n");
}

function attachmentsMarkdown(paths: string[]): string {
  if (paths.length === 0) return "";
  return paths.map((p) => `- ${p}`).join("\n");
}

function buildBoardMarkdown(
  team: Team,
  agents: TeamAgent[],
  skillsMd: string,
  attachmentsMd: string,
  customRoles: TeamCustomRole[] = [],
): string {
  const sections = [
    `# Team Board: ${team.name}`,
    "",
    `**Goal:** ${team.goal || "(not specified)"}`,
    `**Project:** ${team.projectPath}`,
    "",
    "## Roster",
    rosterMarkdown(team, agents, customRoles),
    "",
    "## Active Skills",
    skillsMd || "_(none)_",
    "",
    "## Task Breakdown",
    "_Coordinator fills this in. Each row: Task ID, Owner, Owned Files, Status, Acceptance Criteria._",
    "",
    "| Task | Owner | Files | Status | Acceptance |",
    "| --- | --- | --- | --- | --- |",
    "",
    "## Agent Status",
    ...agents.flatMap((a) => [`### ${a.label} (${roleLabel(a.role, customRoles)})`, "_WAITING_", ""]),
    "## Completed Work Log",
    "_Append entries as tasks finish._",
    "",
  ];
  if (attachmentsMd) sections.push("## Attachments", attachmentsMd, "");
  return sections.join("\n");
}

/**
 * End-to-end team launch. Idempotent w.r.t. team_init (the on-disk dir is
 * created once; subsequent calls preserve BOARD.md), so calling this on a
 * resumed team is safe.
 */
export async function launchTeam(
  teamId: string,
  options: LaunchTeamOptions = {},
): Promise<LaunchTeamResult | null> {
  const teamState = useTeamStore.getState();
  const team = teamState.teams.find((t) => t.id === teamId);
  if (!team) return null;
  const teamAgents = teamState.agents[teamId] ?? [];
  if (teamAgents.length === 0) return null;
  const skillIds = teamState.skills[teamId] ?? [];
  const attachments = teamState.attachments[teamId] ?? [];

  const customSkills = options.customSkills ?? [];
  const customRoles = options.customRoles ?? [];
  const skillsMd = renderSkillsMarkdown(skillIds, customSkills);
  const attachmentsMd = attachmentsMarkdown(attachments.map((a) => a.path));

  const paths = await teamInit({
    teamId: team.id,
    projectPath: team.projectPath,
    boardMarkdown: buildBoardMarkdown(team, teamAgents, skillsMd, attachmentsMd, customRoles),
  });

  await ensureAgentApi().catch(() => null);
  const apiEnv = agentApiEnv();

  const roster = rosterMarkdown(team, teamAgents, customRoles);
  const presets: PanePreset[] = [];
  const labelOrder: string[] = [];

  const kanbanAgents = useKanbanStore.getState().agents;

  for (const ta of teamAgents) {
    const programAgent = kanbanAgents.find((a) => a.id === ta.agentId);
    if (!programAgent) {
      console.warn(`team launch: missing agent program ${ta.agentId} for ${ta.label}`);
      continue;
    }
    const promptBody =
      ta.systemPromptOverride ??
      renderRolePrompt({
        role: ta.role as TeamRole,
        label: ta.label,
        goal: team.goal,
        teamDir: paths.teamDir,
        boardPath: paths.boardPath,
        messagesPath: paths.messagesPath,
        rosterMarkdown: roster,
        skillsMarkdown: skillsMd,
        attachmentsMarkdown: attachmentsMd,
        customRoles,
      });

    const promptFile = await teamWritePrompt({
      teamDir: paths.teamDir,
      label: ta.label,
      body: promptBody,
    });

    // Reuse the agent_launch pipeline so {task_file} interpolation, env merge,
    // and POSIX shell quoting all happen exactly the same as Kanban runs.
    const plan = await agentLaunch({
      agentCommand: programAgent.command,
      taskId: `${team.id}:${ta.id}`,
      taskTitle: `${ta.label} — ${team.name}`,
      taskBody: promptBody,
      taskColumn: "",
      systemPrompt: programAgent.systemPrompt,
      envJson: programAgent.envJson,
    });

    // Override the {task_file} target so it points at our per-agent prompt
    // instead of the throwaway one agent_launch wrote to /tmp.
    const command = programAgent.command
      .replace(/\{task_file\}/g, promptFile.path)
      .replace(/\{task_id\}/g, shellQuote(`${team.id}:${ta.id}`))
      .replace(/\{task_title\}/g, shellQuote(`${ta.label} — ${team.name}`))
      .replace(/\{task_column\}/g, shellQuote(""));

    const env: Record<string, string> = {
      ...plan.env,
      ...apiEnv,
      TEAMSHIP_TASK_FILE: promptFile.path,
      TEAMSHIP_TEAM_DIR: paths.teamDir,
      TEAMSHIP_TEAM_ID: team.id,
      TEAMSHIP_TEAM_NAME: team.name,
      TEAMSHIP_AGENT_LABEL: ta.label,
      TEAMSHIP_AGENT_ROLE: ta.role,
      TEAMSHIP_AGENT_ID: ta.id,
      TEAMSHIP_BOARD_PATH: paths.boardPath,
      TEAMSHIP_MESSAGES_PATH: paths.messagesPath,
      TEAMSHIP_TEAM_TMSG: paths.tmsgPath,
    };

    presets.push({
      kind: "terminal",
      pendingCommand: command,
      spawnEnv: env,
      spawnCwd: team.projectPath,
      title: `${ta.label} (${roleLabel(ta.role, customRoles)})`,
    });
    labelOrder.push(ta.label);
  }

  const ws = useWorkspaceStore.getState();
  const tabId = ws.newTab(presets.length, team.name, presets, team.projectPath);

  // After newTab, the tab's pane ids are stable. Map them back to labels in
  // ordinal order and persist for resume.
  const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
  const paneIdsByLabel: Record<string, string> = {};
  if (tab) {
    const orderedPaneIds = collectLeafIds(tab.layout);
    for (let i = 0; i < labelOrder.length && i < orderedPaneIds.length; i++) {
      const label = labelOrder[i];
      const paneId = orderedPaneIds[i];
      paneIdsByLabel[label] = paneId;
      const ta = teamAgents.find((a) => a.label === label);
      if (ta) {
        await useTeamStore.getState().setPaneId(ta.id, paneId);
      }
      // Stamp pane+tab ids into the agent's spawnEnv so curl from inside the
      // agent's terminal can authenticate as that pane without env discovery.
      const pane = tab.panes[paneId];
      if (pane && pane.kind === "terminal") {
        const existingEnv = (pane.payload?.spawnEnv as Record<string, string> | undefined) ?? {};
        ws.setPanePayload(tabId, paneId, {
          ...(pane.payload ?? {}),
          spawnEnv: {
            ...existingEnv,
            TEAMSHIP_PANE_ID: paneId,
            TEAMSHIP_TAB_ID: tabId,
          },
        });
      }
    }
    // Tag the tab so it survives reload as a Team workspace.
    ws.setPanePayload(
      tab.id,
      orderedPaneIds[0],
      { ...(tab.panes[orderedPaneIds[0]].payload ?? {}), teamId: team.id },
    );
  }

  await useTeamStore.getState().setTabId(team.id, tabId);

  try {
    await teamWatchStart(team.id, paths.teamDir);
  } catch (err) {
    console.warn("team_watch_start failed", err);
  }
  try {
    await subscribeTeamRpc(team.id, paths.teamDir);
  } catch (err) {
    console.warn("subscribeTeamRpc failed", err);
  }

  ws.setActiveTab(tabId);
  ws.setView("workspace");

  return { tabId, paneIdsByLabel };
}

function collectLeafIds(layout: import("./types").LayoutNode): string[] {
  if (layout.type === "leaf") return [layout.paneId];
  return layout.children.flatMap(collectLeafIds);
}

function shellQuote(v: string): string {
  return `'${v.replace(/'/g, `'\\''`)}'`;
}

export type AddAgentToLiveTeamArgs = {
  teamId: string;
  label: string;
  role: TeamRole;
  /** Defaults to the team's first agent's program if omitted. */
  agentId?: string;
  systemPromptOverride?: string;
  /** Pane to split off; defaults to the team tab's rightmost leaf, then the
   *  active pane. Reject if the tab has no terminal panes. */
  anchorPaneId?: string;
  splitDirection?: "vertical" | "horizontal";
  customRoles?: TeamCustomRole[];
  customSkills?: TeamSkill[];
};

export type AddAgentToLiveTeamResult = {
  teamAgentId: string;
  paneId: string;
  label: string;
};

/**
 * Grow a live team's roster by one agent: persist the team_agents row, render
 * its prompt file, derive the launch command via agent_launch, split a pane
 * adjacent to the anchor, then link the new pane back to the agent.
 *
 * Used by:
 *  - tmsg pane new (teamRpc.handleNew) — anchorPaneId is the requesting agent's pane
 *  - Super Agent's add_team_agent tool — anchorPaneId defaults to rightmost leaf
 *  - Super Agent's update_team_agent tool with respawn=true (close + re-add in place)
 */
export async function addAgentToLiveTeam(
  args: AddAgentToLiveTeamArgs,
): Promise<AddAgentToLiveTeamResult> {
  const teamState = useTeamStore.getState();
  const team = teamState.teams.find((t) => t.id === args.teamId);
  if (!team) throw new Error(`team ${args.teamId} not found`);
  if (!team.tabId) throw new Error(`team ${team.name} has no live tab — call set_team_status active and launch_team`);

  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === team.tabId);
  if (!tab) throw new Error(`team ${team.name} tab ${team.tabId} is gone`);

  const leaves = collectLeafIds(tab.layout);
  const terminalLeaves = leaves.filter((id) => tab.panes[id]?.kind === "terminal");
  if (terminalLeaves.length === 0) {
    throw new Error(`team ${team.name} tab has no terminal panes to anchor against`);
  }

  const anchorPaneId = args.anchorPaneId ?? terminalLeaves[terminalLeaves.length - 1];
  if (!leaves.includes(anchorPaneId)) {
    throw new Error(`anchor_pane_id ${anchorPaneId} is not in this team's tab`);
  }

  const existingAgents = teamState.agents[args.teamId] ?? [];
  const agentId = args.agentId ?? existingAgents[0]?.agentId;
  if (!agentId) throw new Error("no agent_id provided and team has no existing agents to clone from");

  const kanbanAgents = useKanbanStore.getState().agents;
  const programAgent = kanbanAgents.find((a) => a.id === agentId);
  if (!programAgent) throw new Error(`AI program ${agentId} not found in agents store`);

  // Persist the new team_agents row first; addAgent enforces label uniqueness.
  const newTa = await useTeamStore.getState().addAgent(team.id, {
    label: args.label,
    role: args.role,
    agentId,
    systemPromptOverride: args.systemPromptOverride,
  });

  const skillIds = teamState.skills[team.id] ?? [];
  const attachments = teamState.attachments[team.id] ?? [];
  const customRoles = args.customRoles ?? [];
  const customSkills = args.customSkills ?? [];
  const skillsMd = renderSkillsMarkdown(skillIds, customSkills);
  const attachmentsMd = attachmentsMarkdown(attachments.map((a) => a.path));

  // Re-derive paths via team_init (idempotent, preserves BOARD.md).
  const teamAgentsAfter = useTeamStore.getState().agents[team.id] ?? [];
  const rosterMd = rosterMarkdown(team, teamAgentsAfter, customRoles);
  const paths = await teamInit({
    teamId: team.id,
    projectPath: team.projectPath,
    boardMarkdown: buildBoardMarkdown(team, teamAgentsAfter, skillsMd, attachmentsMd, customRoles),
  });

  const promptBody =
    args.systemPromptOverride ??
    renderRolePrompt({
      role: args.role,
      label: args.label,
      goal: team.goal,
      teamDir: paths.teamDir,
      boardPath: paths.boardPath,
      messagesPath: paths.messagesPath,
      rosterMarkdown: rosterMd,
      skillsMarkdown: skillsMd,
      attachmentsMarkdown: attachmentsMd,
      customRoles,
    });

  const promptFile = await teamWritePrompt({
    teamDir: paths.teamDir,
    label: args.label,
    body: promptBody,
  });

  const plan = await agentLaunch({
    agentCommand: programAgent.command,
    taskId: `${team.id}:${newTa.id}`,
    taskTitle: `${args.label} — ${team.name}`,
    taskBody: promptBody,
    taskColumn: "",
    systemPrompt: programAgent.systemPrompt,
    envJson: programAgent.envJson,
  });

  const command = programAgent.command
    .replace(/\{task_file\}/g, promptFile.path)
    .replace(/\{task_id\}/g, shellQuote(`${team.id}:${newTa.id}`))
    .replace(/\{task_title\}/g, shellQuote(`${args.label} — ${team.name}`))
    .replace(/\{task_column\}/g, shellQuote(""));

  await ensureAgentApi().catch(() => null);
  const preset: PanePreset = {
    kind: "terminal",
    pendingCommand: command,
    spawnEnv: {
      ...plan.env,
      ...agentApiEnv(),
      TEAMSHIP_TASK_FILE: promptFile.path,
      TEAMSHIP_TEAM_DIR: paths.teamDir,
      TEAMSHIP_TEAM_ID: team.id,
      TEAMSHIP_TEAM_NAME: team.name,
      TEAMSHIP_AGENT_LABEL: args.label,
      TEAMSHIP_AGENT_ROLE: args.role,
      TEAMSHIP_AGENT_ID: newTa.id,
      TEAMSHIP_BOARD_PATH: paths.boardPath,
      TEAMSHIP_MESSAGES_PATH: paths.messagesPath,
      TEAMSHIP_TEAM_TMSG: paths.tmsgPath,
    },
    spawnCwd: team.projectPath,
    title: `${args.label} (${roleLabel(args.role, customRoles)})`,
  };

  // Diff the leaf set before/after to discover the new pane id.
  const tabBefore = useWorkspaceStore.getState().tabs.find((t) => t.id === team.tabId);
  const before = tabBefore ? new Set(collectLeafIds(tabBefore.layout)) : new Set<string>();
  useWorkspaceStore
    .getState()
    .splitPane(team.tabId, anchorPaneId, args.splitDirection ?? "vertical", preset);
  const tabAfter = useWorkspaceStore.getState().tabs.find((t) => t.id === team.tabId);
  if (!tabAfter) throw new Error("tab disappeared during split");
  const newPaneId = collectLeafIds(tabAfter.layout).find((id) => !before.has(id));
  if (!newPaneId) throw new Error("split succeeded but new pane id not found");

  await useTeamStore.getState().setPaneId(newTa.id, newPaneId);
  // Stamp the new pane id into spawnEnv so the agent can curl as itself.
  const tabFinal = useWorkspaceStore.getState().tabs.find((t) => t.id === team.tabId);
  const newPane = tabFinal?.panes[newPaneId];
  if (newPane && newPane.kind === "terminal") {
    const existingEnv = (newPane.payload?.spawnEnv as Record<string, string> | undefined) ?? {};
    useWorkspaceStore.getState().setPanePayload(team.tabId, newPaneId, {
      ...(newPane.payload ?? {}),
      spawnEnv: {
        ...existingEnv,
        TEAMSHIP_PANE_ID: newPaneId,
        TEAMSHIP_TAB_ID: team.tabId,
      },
    });
  }
  return { teamAgentId: newTa.id, paneId: newPaneId, label: args.label };
}

/**
 * Restore a team's panes after app restart. The workspace store rehydrates
 * tabs (panes survive, but `pendingCommand` is in EPHEMERAL_KEYS and gets
 * stripped). We re-render each agent's prompt file, re-derive the launch
 * command, and write a fresh `pendingCommand` into the pane payload. The
 * Terminal mount effect picks it up after the 600 ms shell-prompt delay.
 *
 * Idempotent: safe to call multiple times for the same team.
 */
export async function resumeTeam(teamId: string): Promise<boolean> {
  const teamState = useTeamStore.getState();
  const team = teamState.teams.find((t) => t.id === teamId);
  if (!team || team.status !== "active" || !team.tabId) {
    console.log("[team.resume] skip", { teamId, found: !!team, status: team?.status, tabId: team?.tabId });
    return false;
  }
  const teamAgents = teamState.agents[teamId] ?? [];
  if (teamAgents.length === 0) {
    console.log("[team.resume] skip — no agents in roster", { teamId });
    return false;
  }
  console.log("[team.resume] start", { teamId, name: team.name, agentCount: teamAgents.length });
  const skillIds = teamState.skills[teamId] ?? [];
  const attachments = teamState.attachments[teamId] ?? [];
  const teamSettings = useTeamSettingsStore.getState().settings;
  const customRoles = teamSettings.customRoles;
  const customSkills = teamSettings.customSkills;

  const skillsMd = renderSkillsMarkdown(skillIds, customSkills);
  const attachmentsMd = attachmentsMarkdown(attachments.map((a) => a.path));

  const paths = await teamInit({
    teamId: team.id,
    projectPath: team.projectPath,
    boardMarkdown: buildBoardMarkdown(team, teamAgents, skillsMd, attachmentsMd, customRoles),
  });

  await ensureAgentApi().catch(() => null);
  const apiEnv = agentApiEnv();

  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === team.tabId);
  if (!tab) return false;

  const roster = rosterMarkdown(team, teamAgents, customRoles);
  const kanbanAgents = useKanbanStore.getState().agents;

  let restored = 0;
  let skipped = 0;
  for (const ta of teamAgents) {
    if (!ta.paneId) {
      console.log("[team.resume] skip agent — no paneId", { label: ta.label });
      skipped++;
      continue;
    }
    const pane = tab.panes[ta.paneId];
    if (!pane || pane.kind !== "terminal") {
      console.log("[team.resume] skip agent — pane missing or wrong kind", {
        label: ta.label,
        paneId: ta.paneId,
        kind: pane?.kind,
      });
      skipped++;
      continue;
    }
    const programAgent = kanbanAgents.find((a) => a.id === ta.agentId);
    if (!programAgent) {
      console.log("[team.resume] skip agent — program agent gone", {
        label: ta.label,
        agentId: ta.agentId,
      });
      skipped++;
      continue;
    }

    const promptBody =
      ta.systemPromptOverride ??
      renderRolePrompt({
        role: ta.role as TeamRole,
        label: ta.label,
        goal: team.goal,
        teamDir: paths.teamDir,
        boardPath: paths.boardPath,
        messagesPath: paths.messagesPath,
        rosterMarkdown: roster,
        skillsMarkdown: skillsMd,
        attachmentsMarkdown: attachmentsMd,
        customRoles,
      });
    const promptFile = await teamWritePrompt({
      teamDir: paths.teamDir,
      label: ta.label,
      body: promptBody,
    });

    const command = programAgent.command
      .replace(/\{task_file\}/g, promptFile.path)
      .replace(/\{task_id\}/g, shellQuote(`${team.id}:${ta.id}`))
      .replace(/\{task_title\}/g, shellQuote(`${ta.label} — ${team.name}`))
      .replace(/\{task_column\}/g, shellQuote(""));

    const env: Record<string, string> = {
      ...(programAgent.envJson ? safeParseJson(programAgent.envJson) : {}),
      ...apiEnv,
      TEAMSHIP_TASK_FILE: promptFile.path,
      TEAMSHIP_TEAM_DIR: paths.teamDir,
      TEAMSHIP_TEAM_ID: team.id,
      TEAMSHIP_TEAM_NAME: team.name,
      TEAMSHIP_AGENT_LABEL: ta.label,
      TEAMSHIP_AGENT_ROLE: ta.role,
      TEAMSHIP_AGENT_ID: ta.id,
      TEAMSHIP_BOARD_PATH: paths.boardPath,
      TEAMSHIP_MESSAGES_PATH: paths.messagesPath,
      TEAMSHIP_TEAM_TMSG: paths.tmsgPath,
      TEAMSHIP_PANE_ID: ta.paneId,
      TEAMSHIP_TAB_ID: team.tabId,
    };

    ws.setPanePayload(team.tabId, ta.paneId, {
      ...(pane.payload ?? {}),
      pendingCommand: command,
      spawnEnv: env,
      spawnCwd: team.projectPath,
      title: `${ta.label} (${roleLabel(ta.role, customRoles)})`,
      teamId: team.id,
      teamAgentId: ta.id,
    });
    restored++;
  }
  console.log("[team.resume] done", { teamId, restored, skipped });

  try {
    await teamWatchStart(team.id, paths.teamDir);
  } catch (err) {
    console.warn("team_watch_start (resume) failed", err);
  }
  try {
    await subscribeTeamRpc(team.id, paths.teamDir);
  } catch (err) {
    console.warn("subscribeTeamRpc (resume) failed", err);
  }
  return true;
}

function safeParseJson(s: string): Record<string, string> {
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const out: Record<string, string> = {};
      for (const [k, val] of Object.entries(v)) out[k] = String(val);
      return out;
    }
  } catch {
    /* fall through */
  }
  return {};
}
