import { useEffect, useId, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { TEMPLATES, useWorkspaceStore, type PanePreset } from "../../stores/workspaceStore";
import { useKanbanStore } from "../../stores/kanbanStore";
import { agentLaunch } from "../../lib/tauri";
import { Icon } from "../ui/Icon";
import { suggestTemplateSetup } from "../../lib/aiSuggest/templateSetup";
import { AiSuggestNotConfiguredError } from "../../lib/aiSuggest/runner";

type Step = "template" | "agents";

/**
 * Body of the "Quick start (template)" flow inside the unified
 * NewWorkspacePicker modal. Renders only the content; the modal shell
 * (backdrop, focus trap, close button) is provided by the parent picker.
 */
export function TemplatePickerForm({ onClose, titleId }: { onClose: () => void; titleId: string }) {
  const [step, setStep] = useState<Step>("template");
  const [chosen, setChosen] = useState<typeof TEMPLATES[number] | null>(null);
  const [projectPath, setProjectPath] = useState<string>("");
  const [paneAssign, setPaneAssign] = useState<Record<number, string>>({});
  const [goal, setGoal] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestNeedsConfig, setSuggestNeedsConfig] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const newTab = useWorkspaceStore((s) => s.newTab);
  const setView = useWorkspaceStore((s) => s.setView);
  const agents = useKanbanStore((s) => s.agents);

  const projectInputId = useId();
  const goalInputId = useId();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const launch = async () => {
    if (!chosen) return;
    const presets: PanePreset[] = [];
    for (let i = 0; i < chosen.panes; i++) {
      const assignment = paneAssign[i] ?? "";

      if (assignment === "preview") {
        presets.push({
          kind: "preview",
          spawnCwd: projectPath || undefined,
          title: "Preview",
        });
        continue;
      }
      if (assignment === "editor") {
        presets.push({ kind: "editor", title: "Editor" });
        continue;
      }
      if (assignment === "files") {
        presets.push({ kind: "filebrowser", title: "Files" });
        continue;
      }

      const agentId = assignment.startsWith("agent:") ? assignment.slice("agent:".length) : "";
      const agent = agents.find((a) => a.id === agentId);
      if (!agent) {
        presets.push({ kind: "terminal", spawnCwd: projectPath || undefined });
        continue;
      }
      const plan = await agentLaunch({
        agentCommand: agent.command,
        taskTitle: `pane ${i + 1}`,
        taskBody: `Auto-launched in workspace at ${new Date().toLocaleString()}`,
        systemPrompt: agent.systemPrompt,
      });
      presets.push({
        kind: "terminal",
        pendingCommand: plan.command,
        spawnEnv: plan.env,
        spawnCwd: projectPath || undefined,
        title: agent.name,
      });
    }

    const finalPresets = presets.map((p) =>
      p.kind === "preview" && projectPath
        ? { ...p, spawnCwd: undefined } // preview pane doesn't spawn a shell
        : p,
    );

    const tabId = newTab(chosen.panes, chosen.label, finalPresets, projectPath);

    if (projectPath) {
      const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
      if (tab) {
        const setPanePayload = useWorkspaceStore.getState().setPanePayload;
        Object.values(tab.panes).forEach((p) => {
          if (p.kind === "preview") setPanePayload(tab.id, p.id, { projectPath });
        });
      }
    }
    onClose();
  };

  const pickProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") setProjectPath(selected);
  };

  const runSuggest = async () => {
    console.log("[suggestWithAi:template] click", {
      goalLen: goal.trim().length,
      agents: agents.length,
    });
    if (suggesting || !goal.trim()) return;
    setSuggestError(null);
    setSuggestNote(null);
    setSuggestNeedsConfig(false);
    setSuggesting(true);
    try {
      const out = await suggestTemplateSetup({
        goal,
        templates: TEMPLATES.map((t) => ({ id: t.id, label: t.label, panes: t.panes })),
        agents: agents.map((a) => ({ id: a.id, name: a.name, command: a.command })),
      });
      const tpl = TEMPLATES.find((t) => t.id === out.templateId);
      if (tpl) setChosen(tpl);
      setPaneAssign(out.paneAssign);
      if (out.notes) setSuggestNote(out.notes);
      setStep("agents");
    } catch (err) {
      console.error("[suggestWithAi:template] caught", err);
      if (err instanceof AiSuggestNotConfiguredError) {
        setSuggestNeedsConfig(true);
        setSuggestError(err.message);
      } else {
        setSuggestError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSuggesting(false);
    }
  };

  if (step === "template") {
    return (
      <>
        <h2 id={titleId} className="modal-title">Quick start — pick a layout</h2>
        <div className="modal-sub">
          Pick a layout, or describe your goal and let the AI lay it out.
        </div>

        <div className="form-row">
          <label htmlFor={goalInputId}>What are you working on? (optional)</label>
          <div className="form-row-inline">
            <input
              id={goalInputId}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="e.g. Build a Next.js landing page with live preview"
              onKeyDown={(e) => {
                if (e.key === "Enter" && goal.trim() && !suggesting) {
                  e.preventDefault();
                  void runSuggest();
                }
              }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={runSuggest}
              disabled={suggesting || !goal.trim()}
              title={
                !goal.trim()
                  ? "Type a goal first to enable AI suggestions"
                  : "Ask the configured AI to pick a layout and assign panes"
              }
            >
              <Icon name="sparkles" size={12} />
              <span>{suggesting ? "Thinking…" : "Suggest with AI"}</span>
            </button>
          </div>
          {suggestError && (
            <div className="form-hint form-hint-error">
              AI: {suggestError}
              {suggestNeedsConfig && (
                <>
                  {" — "}
                  <button
                    type="button"
                    className="team-section-link"
                    onClick={() => {
                      setView("settings");
                      onClose();
                    }}
                  >
                    Open Settings → AI
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="template-grid">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              className="template-card"
              onClick={() => {
                setChosen(t);
                setStep("agents");
              }}
            >
              <TemplatePreview panes={t.panes} />
              <div className="template-label">{t.label}</div>
              <div className="template-sub">{t.panes} pane{t.panes === 1 ? "" : "s"}</div>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </>
    );
  }

  if (!chosen) return null;

  return (
    <>
      <h2 id={titleId} className="modal-title">Agents — {chosen.label}</h2>
      <div className="modal-sub">
        Pick an agent for each pane (or leave as <em>Plain shell</em>).
        Optionally point the workspace at a project folder.
      </div>
      {suggestNote && <div className="form-hint">AI: {suggestNote}</div>}

      <div className="form-row">
        <label htmlFor={projectInputId}>Project folder (optional)</label>
        <div className="form-row-inline">
          <input
            id={projectInputId}
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            placeholder="defaults to current shell cwd"
          />
          <button className="btn btn-ghost" onClick={pickProject}>Pick…</button>
        </div>
      </div>

      <div className="agent-slot-grid">
        {Array.from({ length: chosen.panes }, (_, i) => (
          <div key={i} className="agent-slot">
            <div className="agent-slot-num">Pane {i + 1}</div>
            <select
              value={paneAssign[i] ?? ""}
              onChange={(e) =>
                setPaneAssign((m) => ({ ...m, [i]: e.target.value }))
              }
            >
              <option value="">— Plain shell —</option>
              <optgroup label="Other pane kinds">
                <option value="preview">Live preview</option>
                <option value="editor">Editor</option>
                <option value="files">File browser</option>
              </optgroup>
              {agents.length > 0 && (
                <optgroup label="Agents">
                  {agents.map((a) => (
                    <option key={a.id} value={`agent:${a.id}`}>{a.name}</option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        ))}
      </div>

      <div className="modal-actions">
        <button className="btn btn-ghost btn-with-icon" onClick={() => setStep("template")}>
          <Icon name="chevron-left" size={14} />
          <span>Layouts</span>
        </button>
        <div style={{ flex: 1 }} />
        <button
          className="btn btn-ghost"
          onClick={() => {
            newTab(
              chosen.panes,
              chosen.label,
              projectPath
                ? Array.from({ length: chosen.panes }, () => ({ spawnCwd: projectPath }))
                : undefined,
              projectPath || undefined,
            );
            onClose();
          }}
        >
          Skip agents
        </button>
        <button className="btn btn-primary" onClick={launch}>Launch</button>
      </div>
    </>
  );
}

function TemplatePreview({ panes }: { panes: number }) {
  let cols = 1;
  let rows = 1;
  if (panes === 2) { cols = 2; rows = 1; }
  else if (panes === 4) { cols = 2; rows = 2; }
  else if (panes === 6) { cols = 3; rows = 2; }
  else if (panes === 8) { cols = 4; rows = 2; }
  else if (panes === 9) { cols = 3; rows = 3; }
  else if (panes === 12) { cols = 4; rows = 3; }
  else if (panes === 16) { cols = 4; rows = 4; }

  return (
    <div
      className="template-preview"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {Array.from({ length: panes }, (_, i) => (
        <div key={i} className="template-cell" />
      ))}
    </div>
  );
}
