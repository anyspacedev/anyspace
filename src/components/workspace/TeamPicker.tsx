import { useEffect, useId, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../ui/Icon";
import { useFocusReturn } from "../../lib/useFocusReturn";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useTeamStore } from "../../stores/teamStore";
import { defaultRoster, ROLE_LABELS, TEAM_ROLES, type TeamRole } from "../../lib/teamRoles";
import { BUILTIN_SKILLS } from "../../lib/teamSkills";
import { launchTeam } from "../../lib/teamLauncher";

type RosterRow = {
  label: string;
  role: TeamRole;
  agentId: string;
};

function pathBasename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "");
  return trimmed.split(/[/\\]/).pop() ?? trimmed;
}

export function TeamPickerModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [projectPath, setProjectPath] = useState("");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [skills, setSkills] = useState<string[]>(["test-driven", "keep-ci-green"]);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const agents = useKanbanStore((s) => s.agents);
  const createTeam = useTeamStore((s) => s.create);

  const titleId = useId();
  useFocusReturn(open);

  const reset = () => {
    setName("");
    setGoal("");
    setProjectPath("");
    setRoster([]);
    setSkills(["test-driven", "keep-ci-green"]);
    setAttachments([]);
    setError(null);
    setBusy(false);
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    if (roster.length === 0) {
      const fallback = agents[0]?.id ?? "";
      setRoster(
        defaultRoster().map((r) => ({ label: r.label, role: r.role, agentId: fallback })),
      );
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const pickProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") {
      setProjectPath(selected);
      if (!name.trim()) setName(pathBasename(selected) || "Team");
    }
  };

  const pickAttachments = async () => {
    const selected = await openDialog({ multiple: true });
    if (Array.isArray(selected)) {
      setAttachments((prev) => Array.from(new Set([...prev, ...selected])));
    } else if (typeof selected === "string") {
      setAttachments((prev) => Array.from(new Set([...prev, selected])));
    }
  };

  const updateRow = (i: number, patch: Partial<RosterRow>) => {
    setRoster((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    const fallback = agents[0]?.id ?? "";
    const builderCount = roster.filter((r) => r.role === "builder").length + 1;
    setRoster((rows) => [
      ...rows,
      { role: "builder", label: `Builder ${builderCount}`, agentId: fallback },
    ]);
  };

  const removeRow = (i: number) => {
    setRoster((rows) => rows.filter((_, idx) => idx !== i));
  };

  const validRoster = roster.filter((r) => r.label.trim() && r.agentId);
  const labelsUnique =
    new Set(validRoster.map((r) => r.label.trim().toLowerCase())).size === validRoster.length;
  const canLaunch =
    !busy &&
    projectPath.trim().length > 0 &&
    validRoster.length > 0 &&
    labelsUnique &&
    name.trim().length > 0;

  const launch = async () => {
    if (!canLaunch) return;
    setBusy(true);
    setError(null);
    try {
      const { team } = await createTeam({
        name: name.trim(),
        projectPath: projectPath.trim(),
        goal: goal.trim(),
        agents: validRoster.map((r) => ({
          label: r.label.trim(),
          role: r.role,
          agentId: r.agentId,
        })),
        skillIds: skills,
        attachments: attachments.map((p) => ({ path: p })),
      });
      const result = await launchTeam(team.id);
      if (!result) {
        setError("Failed to launch team — check that every agent has a configured program.");
        setBusy(false);
        return;
      }
      reset();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={busy ? undefined : reset}>
      <div
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div id={titleId} className="modal-title">New Team workspace</div>
        <div className="modal-sub">
          Spin up multiple AI agents around a shared goal. Each agent runs in
          its own pane and they coordinate through a markdown message bus.
        </div>

        <div className="form-row">
          <label>Team name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Settings refactor"
          />
        </div>

        <div className="form-row">
          <label>Goal</label>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What is this team trying to accomplish?"
            rows={3}
          />
        </div>

        <div className="form-row">
          <label>Project folder</label>
          <div className="form-row-inline">
            <input
              value={projectPath}
              onChange={(e) => setProjectPath(e.target.value)}
              placeholder="Pick the working directory"
            />
            <button className="btn btn-ghost" type="button" onClick={pickProject}>Pick…</button>
          </div>
        </div>

        {agents.length === 0 && (
          <div className="form-hint form-hint-error">
            No AI agents configured. Open the Agents panel to add Claude / Codex / etc. before launching a team.
          </div>
        )}

        <div className="form-row">
          <label>Roster</label>
          <div className="team-roster">
            {roster.map((r, i) => (
              <div key={i} className="team-roster-row">
                <select
                  aria-label="Role"
                  value={r.role}
                  onChange={(e) => updateRow(i, { role: e.target.value as TeamRole })}
                >
                  {TEAM_ROLES.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
                <input
                  aria-label="Label"
                  value={r.label}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                  placeholder="Builder 1"
                />
                <select
                  aria-label="AI program"
                  value={r.agentId}
                  onChange={(e) => updateRow(i, { agentId: e.target.value })}
                >
                  <option value="">— pick agent —</option>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => removeRow(i)}
                  aria-label="Remove row"
                  title="Remove"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-with-icon" onClick={addRow}>
              <Icon name="plus" size={14} />
              <span>Add agent</span>
            </button>
          </div>
          {!labelsUnique && (
            <div className="form-hint form-hint-error">Labels must be unique within a team.</div>
          )}
        </div>

        <div className="form-row">
          <label>Skills</label>
          <div className="team-skill-grid">
            {BUILTIN_SKILLS.map((s) => {
              const checked = skills.includes(s.id);
              return (
                <label key={s.id} className={"team-skill" + (checked ? " active" : "")}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setSkills((prev) =>
                        prev.includes(s.id)
                          ? prev.filter((x) => x !== s.id)
                          : [...prev, s.id],
                      );
                    }}
                  />
                  <span className="team-skill-label">{s.label}</span>
                  <span className="team-skill-body">{s.body}</span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-row">
          <label>Attachments</label>
          <div className="team-attachments">
            {attachments.length === 0 && (
              <div className="form-hint">No files attached. Pick design docs, briefs, etc.</div>
            )}
            {attachments.map((p, i) => (
              <div key={`${p}-${i}`} className="team-attachment-row">
                <span className="team-attachment-path">{p}</span>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() =>
                    setAttachments((prev) => prev.filter((_, idx) => idx !== i))
                  }
                  aria-label="Remove attachment"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-ghost btn-with-icon" onClick={pickAttachments}>
              <Icon name="plus" size={14} />
              <span>Add files…</span>
            </button>
          </div>
        </div>

        {error && <div className="form-hint form-hint-error">{error}</div>}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={reset} disabled={busy}>Cancel</button>
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={launch} disabled={!canLaunch}>
            {busy ? "Launching…" : "Launch team"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function TeamPickerTrigger() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        className="btn btn-ghost btn-with-icon"
        onClick={() => setOpen(true)}
        title="New Team workspace"
      >
        <Icon name="plus" size={14} />
        <span>Team</span>
      </button>
      <TeamPickerModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
