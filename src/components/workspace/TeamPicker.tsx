import { useEffect, useId, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../ui/Icon";
import { useFocusReturn } from "../../lib/useFocusReturn";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useTeamStore } from "../../stores/teamStore";
import { useTeamSettingsStore } from "../../stores/teamSettingsStore";
import { useTeamPickerStore } from "../../stores/teamPickerStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import {
  BUILTIN_ROLES,
  defaultRoster,
  roleAccent,
  roleLabel,
  type TeamRole,
} from "../../lib/teamRoles";
import { BUILTIN_SKILLS, findSkill } from "../../lib/teamSkills";
import { launchTeam } from "../../lib/teamLauncher";
import { decomposeWithAi } from "../../lib/teamDecompose";

type RosterRow = {
  label: string;
  role: TeamRole;
  agentId: string;
};

type Expanded = { roster: boolean; skills: boolean; attachments: boolean };

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
  const [expanded, setExpanded] = useState<Expanded>({
    roster: false,
    skills: false,
    attachments: false,
  });

  const agents = useKanbanStore((s) => s.agents);
  const createTeam = useTeamStore((s) => s.create);
  const customSkills = useTeamSettingsStore((s) => s.settings.customSkills);
  const customRoles = useTeamSettingsStore((s) => s.settings.customRoles);
  const templates = useTeamSettingsStore((s) => s.settings.templates);
  const saveTemplates = useTeamSettingsStore((s) => s.saveTemplates);
  const setView = useWorkspaceStore((s) => s.setView);

  const [savingTemplate, setSavingTemplate] = useState(false);
  const [draftTemplateName, setDraftTemplateName] = useState("");
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [decomposing, setDecomposing] = useState(false);
  const [decomposeNote, setDecomposeNote] = useState<string | null>(null);
  const [decomposeError, setDecomposeError] = useState<string | null>(null);

  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);
  const templatesPopRef = useRef<HTMLDivElement>(null);
  const savePopRef = useRef<HTMLDivElement>(null);
  useFocusReturn(open);
  useFocusTrap(modalRef, open);

  // Close footer popovers on outside click. Both popovers anchor to the
  // footer side-by-side; we also keep them mutually exclusive so opening
  // one closes the other.
  useEffect(() => {
    if (!templatesOpen && !savingTemplate) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (templatesOpen && !templatesPopRef.current?.contains(t)) {
        setTemplatesOpen(false);
      }
      if (savingTemplate && !savePopRef.current?.contains(t)) {
        setSavingTemplate(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [templatesOpen, savingTemplate]);

  const reset = () => {
    setName("");
    setGoal("");
    setProjectPath("");
    setRoster([]);
    setSkills(["test-driven", "keep-ci-green"]);
    setAttachments([]);
    setError(null);
    setBusy(false);
    setExpanded({ roster: false, skills: false, attachments: false });
    setSavingTemplate(false);
    setDraftTemplateName("");
    setTemplatesOpen(false);
    setDecomposeNote(null);
    setDecomposeError(null);
    onClose();
  };

  // Seed default roster on first open of a session.
  useEffect(() => {
    if (!open) return;
    if (roster.length === 0) {
      const fallback = agents[0]?.id ?? "";
      setRoster(
        defaultRoster().map((r) => ({ label: r.label, role: r.role, agentId: fallback })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const validRoster = roster.filter((r) => r.label.trim() && r.agentId);
  const labelsUnique =
    new Set(validRoster.map((r) => r.label.trim().toLowerCase())).size === validRoster.length;
  const duplicateLabels = (() => {
    const seen = new Map<string, number>();
    for (const r of roster) {
      const key = r.label.trim().toLowerCase();
      if (!key) continue;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
  })();
  const isDuplicateRow = (label: string) =>
    duplicateLabels.has(label.trim().toLowerCase());
  const canLaunch =
    !busy &&
    projectPath.trim().length > 0 &&
    validRoster.length > 0 &&
    labelsUnique &&
    name.trim().length > 0;

  // Keyboard: Esc closes, Cmd/Ctrl+Enter launches.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        reset();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canLaunch) {
        e.preventDefault();
        void launch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, busy, canLaunch]);

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

  const runDecompose = async () => {
    setDecomposeError(null);
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
      // Auto-reveal what the AI proposed.
      setExpanded((e) => ({ ...e, roster: true }));
    } catch (err) {
      setDecomposeError(err instanceof Error ? err.message : String(err));
    } finally {
      setDecomposing(false);
    }
  };

  const applyTemplate = (id: string) => {
    const tpl = templates.find((t) => t.id === id);
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
    setTemplatesOpen(false);
    setExpanded((e) => ({ ...e, roster: true }));
  };

  const openManageInSettings = () => {
    setView("settings");
    reset();
  };

  if (!open) return null;

  // Selected skill labels (for collapsed Skills summary).
  const selectedSkills = skills
    .map((id) => findSkill(id, customSkills)?.label ?? id)
    .filter(Boolean);

  return (
    <div className="modal-backdrop" onClick={busy ? undefined : reset}>
      <div
        ref={modalRef}
        className="modal wide pinned"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close modal-close-floating"
          onClick={busy ? undefined : reset}
          disabled={busy}
          aria-label="Close"
        >
          <Icon name="x" size={14} />
        </button>

        <div className="modal-pinned-head">
          <h2 id={titleId} className="modal-title">New team</h2>
          <div className="modal-sub">
            Spin up multiple AI agents around a shared goal.
          </div>
        </div>

        <div className="modal-pinned-body">
          {/* Goal — primary field, autofocus */}
          <div className="form-row">
            <label htmlFor="team-goal">What should the team accomplish?</label>
            <textarea
              id="team-goal"
              autoFocus
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Refactor the settings module to use the new config schema, with tests."
              rows={4}
            />
            <div
              className="form-row-inline"
              style={{ justifyContent: "flex-end", marginTop: 6 }}
            >
              <button
                type="button"
                className="btn btn-ghost btn-with-icon"
                onClick={runDecompose}
                disabled={decomposing || !goal.trim()}
                title="Ask the configured AI to propose a roster + skills"
              >
                <Icon name="sparkles" size={12} />
                <span>{decomposing ? "Thinking…" : "Suggest with AI"}</span>
              </button>
            </div>
            {decomposeError && (
              <div className="form-hint form-hint-error">AI: {decomposeError}</div>
            )}
            {decomposeNote && <div className="form-hint">AI: {decomposeNote}</div>}
          </div>

          {/* Project folder */}
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

          {/* Roster — collapsed summary by default */}
          {!expanded.roster ? (
            <button
              type="button"
              className="team-summary"
              aria-expanded={false}
              onClick={() => setExpanded((e) => ({ ...e, roster: true }))}
            >
              <span className="team-summary-caret" aria-hidden="true">
                <Icon name="chevron-right" size={14} />
              </span>
              <span className="team-summary-title">Roster</span>
              <span className="team-summary-content">
                {roster.length === 0 ? (
                  <span style={{ color: "var(--fg-muted)" }}>No agents</span>
                ) : (
                  roster.map((r, i) => (
                    <span key={i} className="team-summary-chip">
                      <span
                        className="team-summary-chip-dot"
                        style={{ background: roleAccent(r.role, customRoles) }}
                      />
                      {r.label}
                    </span>
                  ))
                )}
              </span>
              <span className="team-summary-edit">edit</span>
            </button>
          ) : (
            <div className="team-section-expanded">
              <div
                className="form-row-inline"
                style={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <strong style={{ fontSize: "var(--font-size-sm)" }}>Roster</strong>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setExpanded((e) => ({ ...e, roster: false }))}
                  aria-label="Collapse roster"
                >
                  <Icon name="chevron-up" size={14} />
                </button>
              </div>

              {/* Team name (only revealed when roster is open) */}
              <div className="form-row">
                <label htmlFor="team-name">Team name</label>
                <input
                  id="team-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Auto-filled from project folder"
                />
              </div>

              <div className="team-roster">
                {roster.map((r, i) => (
                  <div key={i} className="team-roster-row">
                    <select
                      aria-label="Role"
                      value={r.role}
                      onChange={(e) => updateRow(i, { role: e.target.value as TeamRole })}
                    >
                      {BUILTIN_ROLES.map((role) => (
                        <option key={role} value={role}>{roleLabel(role, [])}</option>
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
                      aria-invalid={isDuplicateRow(r.label) || undefined}
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
              <button
                type="button"
                className="team-section-link"
                onClick={openManageInSettings}
              >
                Manage custom roles in Settings →
              </button>
            </div>
          )}

          {/* Skills — collapsed summary by default */}
          {!expanded.skills ? (
            <button
              type="button"
              className="team-summary"
              aria-expanded={false}
              onClick={() => setExpanded((e) => ({ ...e, skills: true }))}
            >
              <span className="team-summary-caret" aria-hidden="true">
                <Icon name="chevron-right" size={14} />
              </span>
              <span className="team-summary-title">Skills</span>
              <span className="team-summary-content">
                {selectedSkills.length === 0 ? (
                  <span style={{ color: "var(--fg-muted)" }}>None selected</span>
                ) : (
                  selectedSkills.map((label, i) => (
                    <span key={i} className="team-summary-chip">{label}</span>
                  ))
                )}
              </span>
              <span className="team-summary-edit">edit</span>
            </button>
          ) : (
            <div className="team-section-expanded">
              <div
                className="form-row-inline"
                style={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <strong style={{ fontSize: "var(--font-size-sm)" }}>Skills</strong>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setExpanded((e) => ({ ...e, skills: false }))}
                  aria-label="Collapse skills"
                >
                  <Icon name="chevron-up" size={14} />
                </button>
              </div>
              <div className="team-skill-grid">
                {[...BUILTIN_SKILLS, ...customSkills].map((s) => {
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
              <button
                type="button"
                className="team-section-link"
                onClick={openManageInSettings}
              >
                Manage custom skills in Settings →
              </button>
            </div>
          )}

          {/* Attachments — collapsed summary by default */}
          {!expanded.attachments ? (
            <button
              type="button"
              className="team-summary"
              aria-expanded={false}
              onClick={() => setExpanded((e) => ({ ...e, attachments: true }))}
            >
              <span className="team-summary-caret" aria-hidden="true">
                <Icon name="chevron-right" size={14} />
              </span>
              <span className="team-summary-title">Attachments</span>
              <span className="team-summary-content">
                <span style={{ color: "var(--fg-muted)" }}>
                  {attachments.length === 0
                    ? "No files"
                    : `${attachments.length} file${attachments.length === 1 ? "" : "s"}`}
                </span>
              </span>
              <span className="team-summary-edit">add</span>
            </button>
          ) : (
            <div className="team-section-expanded">
              <div
                className="form-row-inline"
                style={{ justifyContent: "space-between", alignItems: "center" }}
              >
                <strong style={{ fontSize: "var(--font-size-sm)" }}>Attachments</strong>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => setExpanded((e) => ({ ...e, attachments: false }))}
                  aria-label="Collapse attachments"
                >
                  <Icon name="chevron-up" size={14} />
                </button>
              </div>
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
          )}

          {error && <div className="form-hint form-hint-error">{error}</div>}
        </div>

        <div className="modal-pinned-foot">
          <div className="team-tpl-save-wrap" ref={templatesPopRef}>
            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={() => {
                setTemplatesOpen((v) => !v);
                setSavingTemplate(false);
              }}
              title="Apply a saved template"
              aria-expanded={templatesOpen}
            >
              <Icon name="layers" size={12} />
              <span>Templates</span>
              <Icon name={templatesOpen ? "chevron-up" : "chevron-down"} size={12} />
            </button>
            {templatesOpen && (
              <div className="team-templates-pop" role="menu" aria-label="Templates">
                {templates.length === 0 ? (
                  <div className="team-templates-pop-empty">
                    No saved templates yet — save one after launch.
                  </div>
                ) : (
                  templates.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="team-templates-pop-item"
                      role="menuitem"
                      onClick={() => applyTemplate(t.id)}
                    >
                      <span className="team-templates-pop-name">{t.name}</span>
                      <span className="team-templates-pop-meta">
                        {t.roster.length} {t.roster.length === 1 ? "agent" : "agents"} ·{" "}
                        {t.skillIds.length} {t.skillIds.length === 1 ? "skill" : "skills"}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="team-tpl-save-wrap" ref={savePopRef}>
            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={() => {
                if (!savingTemplate) {
                  setDraftTemplateName(name.trim());
                  setSavingTemplate(true);
                  setTemplatesOpen(false);
                } else {
                  setSavingTemplate(false);
                }
              }}
              disabled={busy || roster.filter((r) => r.label.trim()).length === 0}
              title="Save current roster + skills as a reusable template"
              aria-expanded={savingTemplate}
            >
              <Icon name="layers" size={12} />
              <span>Save as…</span>
            </button>
            {savingTemplate && (
              <div className="team-tpl-save-pop" role="group" aria-label="Save template">
                <label className="team-tpl-save-pop-label" htmlFor="tpl-name-input">
                  Template name
                </label>
                <input
                  id="tpl-name-input"
                  autoFocus
                  value={draftTemplateName}
                  onChange={(e) => setDraftTemplateName(e.target.value)}
                  placeholder="e.g. Refactor squad"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setSavingTemplate(false);
                      setDraftTemplateName("");
                    }
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const btn = e.currentTarget.parentElement?.querySelector(
                        "button.btn-primary",
                      ) as HTMLButtonElement | null;
                      btn?.click();
                    }
                  }}
                />
                <div className="team-tpl-save-pop-actions">
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
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const tplName =
                        draftTemplateName.trim() || name.trim() || "Team template";
                      const tpl = {
                        id: `tpl-${Math.random().toString(36).slice(2, 8)}`,
                        name: tplName,
                        goalSeed: goal.trim() || undefined,
                        roster: roster
                          .filter((r) => r.label.trim())
                          .map((r) => ({
                            role: r.role,
                            label: r.label.trim(),
                            agentId: r.agentId,
                          })),
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
                </div>
              </div>
            )}
          </div>

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
  const setOpen = useTeamPickerStore((s) => s.setOpen);
  return (
    <button
      className="btn btn-ghost btn-with-icon"
      onClick={() => setOpen(true)}
      title="New Team workspace (⌘⇧T)"
    >
      <Icon name="users-round" size={14} />
      <span>Team</span>
    </button>
  );
}
