import { useState } from "react";
import { useTeamStore } from "../../stores/teamStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useKanbanStore } from "../../stores/kanbanStore";
import { roleAccent, roleLabel } from "../../lib/teamRoles";
import { useTeamSettingsStore } from "../../stores/teamSettingsStore";
import { launchTeam } from "../../lib/teamLauncher";
import { Icon } from "../ui/Icon";

function fmtDate(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString();
}

/**
 * Read + manage the saved-teams list (active and archived).
 * Rendered standalone in the dedicated Workspaces management view, and
 * also embedded inside the unified NewWorkspacePicker's "saved" mode.
 *
 * `onActivated` fires after Open / Launch / Reactivate so the parent
 * (e.g. the picker modal) can close itself once a team is focused.
 */
export function TeamRowList({ onActivated }: { onActivated?: () => void } = {}) {
  const teams = useTeamStore((s) => s.teams);
  const teamAgents = useTeamStore((s) => s.agents);
  const archive = useTeamStore((s) => s.archive);
  const reactivate = useTeamStore((s) => s.reactivate);
  const rename = useTeamStore((s) => s.rename);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const kanbanAgents = useKanbanStore((s) => s.agents);
  const customRoles = useTeamSettingsStore((s) => s.settings.customRoles);

  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  const programNameForId = (id: string) => kanbanAgents.find((a) => a.id === id)?.name ?? id;

  const activate = async (teamId: string) => {
    setError(null);
    setBusyId(teamId);
    try {
      const team = useTeamStore.getState().teams.find((t) => t.id === teamId);
      if (!team) return;
      if (team.status === "active" && team.tabId && tabs.some((t) => t.id === team.tabId)) {
        setActiveTab(team.tabId);
        onActivated?.();
        return;
      }
      if (team.status === "archived") {
        await reactivate(teamId);
      } else if (team.tabId) {
        await reactivate(teamId);
      }
      const result = await launchTeam(teamId);
      if (!result) {
        setError("Launch returned null — agent program may be missing.");
        return;
      }
      onActivated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const onRename = async (teamId: string, value: string) => {
    setEditingId(null);
    if (!value.trim()) return;
    await rename(teamId, value);
  };

  if (teams.length === 0) {
    return (
      <div className="teams-empty">
        <div className="teams-empty-title">No saved workspaces yet</div>
        <div className="teams-empty-sub">
          Multi-agent team workspaces persist across restarts. Spin one up
          from the "Multi-agent team" card.
        </div>
      </div>
    );
  }

  return (
    <>
      {error && <div className="teams-error">{error}</div>}
      <div className="teams-list">
        {teams.map((team) => {
          const agents = teamAgents[team.id] ?? [];
          const tabAlive = !!team.tabId && tabs.some((t) => t.id === team.tabId);
          const busy = busyId === team.id;
          return (
            <article key={team.id} className={`team-row team-row-${team.status}`}>
              <div className="team-row-main">
                <div className="team-row-head">
                  {editingId === team.id ? (
                    <input
                      autoFocus
                      defaultValue={team.name}
                      className="team-row-name-input"
                      onBlur={(e) => onRename(team.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onRename(team.id, (e.target as HTMLInputElement).value);
                        if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="team-row-name"
                      onDoubleClick={() => setEditingId(team.id)}
                      title="Double-click to rename"
                    >
                      {team.name}
                    </button>
                  )}
                  <span className={`team-row-status team-row-status-${team.status}`}>
                    {team.status}
                  </span>
                  {tabAlive && <span className="team-row-tab-pill">tab open</span>}
                </div>
                <div className="team-row-meta">
                  <span title={team.projectPath}>
                    <Icon name="folder" size={12} /> {team.projectPath}
                  </span>
                  <span>updated {fmtDate(team.updatedAt)}</span>
                </div>
                {team.goal && <div className="team-row-goal">{team.goal}</div>}
                <div className="team-row-roster">
                  {agents.map((a) => (
                    <span
                      key={a.id}
                      className="team-row-pill"
                      style={{ borderColor: roleAccent(a.role, customRoles) }}
                      title={`${roleLabel(a.role, customRoles)} • ${programNameForId(a.agentId)}`}
                    >
                      {a.label}
                    </span>
                  ))}
                </div>
              </div>
              <div className="team-row-actions">
                <button
                  className="btn btn-primary btn-with-icon"
                  onClick={() => activate(team.id)}
                  disabled={busy}
                  title={tabAlive ? "Focus this team's tab" : team.status === "archived" ? "Reactivate and launch" : "Open in a fresh tab"}
                >
                  <Icon name="play" size={12} />
                  <span>
                    {busy ? "…" : tabAlive ? "Open" : team.status === "archived" ? "Reactivate" : "Launch"}
                  </span>
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setEditingId(team.id)}
                  disabled={busy}
                  title="Rename"
                  aria-label={`Rename team ${team.name}`}
                >
                  <Icon name="file-edit" size={12} />
                </button>
                {team.status === "active" ? (
                  <button
                    className="btn btn-ghost"
                    onClick={() => archive(team.id)}
                    disabled={busy}
                    title="Archive (keeps BOARD.md / MESSAGES.md on disk)"
                    aria-label={`Archive team ${team.name}`}
                  >
                    <Icon name="x" size={12} />
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </>
  );
}
