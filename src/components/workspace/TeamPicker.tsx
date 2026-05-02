import { useEffect, useId, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../ui/Icon";
import { useFocusReturn } from "../../lib/useFocusReturn";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useTeamStore } from "../../stores/teamStore";
import { useTeamSettingsStore } from "../../stores/teamSettingsStore";
import {
  BUILTIN_ROLES,
  defaultRoster,
  isBuiltinRole,
  roleLabel,
  type TeamCustomRole,
  type TeamRole,
} from "../../lib/teamRoles";
import { BUILTIN_SKILLS, type TeamSkill } from "../../lib/teamSkills";
import { launchTeam } from "../../lib/teamLauncher";
import { decomposeWithAi } from "../../lib/teamDecompose";

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
  const customSkills = useTeamSettingsStore((s) => s.settings.customSkills);
  const saveCustomSkills = useTeamSettingsStore((s) => s.saveCustomSkills);
  const customRoles = useTeamSettingsStore((s) => s.settings.customRoles);
  const saveCustomRoles = useTeamSettingsStore((s) => s.saveCustomRoles);
  const templates = useTeamSettingsStore((s) => s.settings.templates);
  const saveTemplates = useTeamSettingsStore((s) => s.saveTemplates);
  const [draftSkillLabel, setDraftSkillLabel] = useState("");
  const [draftSkillBody, setDraftSkillBody] = useState("");
  const [draftRoleLabel, setDraftRoleLabel] = useState("");
  const [draftRoleBody, setDraftRoleBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [draftTemplateName, setDraftTemplateName] = useState("");
  const [decomposing, setDecomposing] = useState(false);
  const [decomposeNote, setDecomposeNote] = useState<string | null>(null);

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
      const result = await launchTeam(team.id, { customSkills, customRoles });
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

        {templates.length > 0 && (
          <div className="form-row">
            <label>Use template</label>
            <div className="form-row-inline">
              <select
                aria-label="Apply template"
                defaultValue=""
                onChange={(e) => {
                  const tpl = templates.find((t) => t.id === e.target.value);
                  if (!tpl) return;
                  if (!name.trim() || tpl.reuseTeamName) setName(tpl.name);
                  if (tpl.goalSeed && !goal.trim()) setGoal(tpl.goalSeed);
                  if (tpl.roster.length > 0) {
                    const fallback = agents[0]?.id ?? "";
                    setRoster(
                      tpl.roster.map((r) => ({
                        role: r.role,
                        label: r.label,
                        agentId:
                          r.agentId && agents.some((a) => a.id === r.agentId)
                            ? r.agentId
                            : fallback,
                      })),
                    );
                  }
                  if (tpl.skillIds.length > 0) setSkills(tpl.skillIds);
                  e.target.value = ""; // reset so re-applying works
                }}
              >
                <option value="">— pick to apply —</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} · {t.roster.length} agents</option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  // Delete the most recently used template only after a confirm;
                  // skip this affordance for now — manage via re-saving with same name.
                }}
                style={{ display: "none" }}
              >
                Manage
              </button>
            </div>
          </div>
        )}

        <div className="form-row">
          <label>Team name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Settings refactor"
          />
        </div>

        <div className="form-row">
          <div className="form-row-inline" style={{ alignItems: "baseline" }}>
            <label style={{ flex: 1 }}>Goal</label>
            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={async () => {
                setError(null);
                setDecomposeNote(null);
                setDecomposing(true);
                try {
                  const out = await decomposeWithAi({
                    goal,
                    projectPath,
                    defaultName: name || "Team",
                  });
                  if (!name.trim()) setName(out.teamName);
                  const fallback = agents[0]?.id ?? "";
                  setRoster(
                    out.roster.map((r) => {
                      const matched = r.programHint
                        ? agents.find((a) =>
                            a.name.toLowerCase().includes(r.programHint!.toLowerCase()),
                          )
                        : undefined;
                      return {
                        role: r.role,
                        label: r.label,
                        agentId: matched?.id ?? fallback,
                      };
                    }),
                  );
                  if (out.skillIds.length > 0) setSkills(out.skillIds);
                  if (out.notes) setDecomposeNote(out.notes);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                } finally {
                  setDecomposing(false);
                }
              }}
              disabled={decomposing || !goal.trim()}
              title="Ask the configured AI to propose a roster + skills"
            >
              <Icon name="sparkles" size={12} />
              <span>{decomposing ? "Thinking…" : "Decompose with AI"}</span>
            </button>
          </div>
          <textarea
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What is this team trying to accomplish?"
            rows={3}
          />
          {decomposeNote && <div className="form-hint">AI: {decomposeNote}</div>}
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
                  {BUILTIN_ROLES.map((role) => (
                    <option key={role} value={role}>{roleLabel(role)}</option>
                  ))}
                  {customRoles.length > 0 && (
                    <optgroup label="Custom roles">
                      {customRoles.map((role) => (
                        <option key={role.id} value={role.id}>{role.label}</option>
                      ))}
                    </optgroup>
                  )}
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
          <label>Custom roles</label>
          {customRoles.length === 0 && (
            <div className="form-hint">
              Add a custom role with its own system-prompt template. Built-in roles cover most cases — only add when you need behavior the existing five don't capture.
            </div>
          )}
          {customRoles.length > 0 && (
            <div className="team-custom-roles">
              {customRoles.map((role) => {
                const inUse = roster.some((r) => r.role === role.id);
                return (
                  <div key={role.id} className="team-custom-role">
                    <div className="team-custom-role-head">
                      <strong>{role.label}</strong>
                      <span className="team-skill-tag">{role.id}</span>
                      {inUse && <span className="team-row-tab-pill">in use</span>}
                    </div>
                    <div className="team-custom-role-body">{role.body}</div>
                    <div className="team-custom-role-actions">
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={() => {
                          if (inUse) return;
                          void saveCustomRoles(customRoles.filter((c) => c.id !== role.id));
                        }}
                        disabled={inUse}
                        title={inUse ? "In use — change roster first" : "Delete"}
                      >
                        <Icon name="x" size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="team-skill-add">
            <input
              aria-label="New role label"
              value={draftRoleLabel}
              onChange={(e) => setDraftRoleLabel(e.target.value)}
              placeholder="Role label (e.g. Architect)"
            />
            <textarea
              aria-label="System prompt body"
              value={draftRoleBody}
              onChange={(e) => setDraftRoleBody(e.target.value)}
              placeholder='Behavioral / role instructions. Use ${BOARD_PATH} and ${MESSAGES_PATH} placeholders.'
              rows={2}
            />
            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={() => {
                const label = draftRoleLabel.trim();
                const body = draftRoleBody.trim();
                if (!label || !body) return;
                const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
                const id = `custom:${slug}-${Math.random().toString(36).slice(2, 6)}`;
                if (isBuiltinRole(id)) return; // shouldn't happen with the prefix, but defensive
                const next: TeamCustomRole = { id, label, body };
                void saveCustomRoles([...customRoles, next]);
                setDraftRoleLabel("");
                setDraftRoleBody("");
              }}
              disabled={!draftRoleLabel.trim() || !draftRoleBody.trim()}
            >
              <Icon name="plus" size={12} />
              <span>Add role</span>
            </button>
          </div>
        </div>

        <div className="form-row">
          <label>Skills</label>
          <div className="team-skill-grid">
            {[...BUILTIN_SKILLS, ...customSkills].map((s) => {
              const checked = skills.includes(s.id);
              const isCustom = customSkills.some((c) => c.id === s.id);
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
                  <span className="team-skill-label">
                    {s.label}
                    {isCustom && <span className="team-skill-tag">custom</span>}
                  </span>
                  <span className="team-skill-body">{s.body}</span>
                  {isCustom && (
                    <button
                      type="button"
                      className="team-skill-delete"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const next = customSkills.filter((c) => c.id !== s.id);
                        void saveCustomSkills(next);
                        setSkills((prev) => prev.filter((x) => x !== s.id));
                      }}
                      aria-label={`Delete custom skill ${s.label}`}
                      title="Delete custom skill"
                    >
                      <Icon name="x" size={11} />
                    </button>
                  )}
                </label>
              );
            })}
          </div>
          <div className="team-skill-add">
            <input
              aria-label="New skill label"
              value={draftSkillLabel}
              onChange={(e) => setDraftSkillLabel(e.target.value)}
              placeholder="Skill label (e.g. Conventional Commits)"
            />
            <input
              aria-label="New skill body"
              value={draftSkillBody}
              onChange={(e) => setDraftSkillBody(e.target.value)}
              placeholder="Behavioral directive — one or two sentences"
            />
            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={() => {
                const label = draftSkillLabel.trim();
                const body = draftSkillBody.trim();
                if (!label || !body) return;
                const id = `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Math.random().toString(36).slice(2, 6)}`;
                const next: TeamSkill = { id, label, body };
                void saveCustomSkills([...customSkills, next]);
                setSkills((prev) => [...prev, id]);
                setDraftSkillLabel("");
                setDraftSkillBody("");
              }}
              disabled={!draftSkillLabel.trim() || !draftSkillBody.trim()}
            >
              <Icon name="plus" size={12} />
              <span>Add custom</span>
            </button>
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

        {savingTemplate ? (
          <div className="form-row">
            <label>Save as template</label>
            <div className="form-row-inline">
              <input
                autoFocus
                value={draftTemplateName}
                onChange={(e) => setDraftTemplateName(e.target.value)}
                placeholder="Template name"
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  const tplName = draftTemplateName.trim() || name.trim() || "Team template";
                  const tpl = {
                    id: `tpl-${Math.random().toString(36).slice(2, 8)}`,
                    name: tplName,
                    goalSeed: goal.trim() || undefined,
                    roster: roster
                      .filter((r) => r.label.trim())
                      .map((r) => ({ role: r.role, label: r.label.trim(), agentId: r.agentId })),
                    skillIds: [...skills],
                  };
                  void saveTemplates([...templates, tpl]);
                  setSavingTemplate(false);
                  setDraftTemplateName("");
                }}
                disabled={roster.filter((r) => r.label.trim()).length === 0}
              >
                Save
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => {
                  setSavingTemplate(false);
                  setDraftTemplateName("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={reset} disabled={busy}>Cancel</button>
          <button
            type="button"
            className="btn btn-ghost btn-with-icon"
            onClick={() => setSavingTemplate(true)}
            disabled={busy || savingTemplate || roster.filter((r) => r.label.trim()).length === 0}
            title="Save current roster + skills as a reusable template"
          >
            <Icon name="layers" size={12} />
            <span>Save as template</span>
          </button>
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
