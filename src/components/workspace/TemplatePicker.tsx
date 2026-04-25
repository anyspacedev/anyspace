import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { TEMPLATES, useWorkspaceStore, type PanePreset } from "../../stores/workspaceStore";
import { useKanbanStore } from "../../stores/kanbanStore";
import { agentLaunch } from "../../lib/tauri";

type Step = "template" | "agents";

export function TemplatePickerTrigger() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("template");
  const [chosen, setChosen] = useState<typeof TEMPLATES[number] | null>(null);
  const [projectPath, setProjectPath] = useState<string>("");
  // Pane assignment: either "agent:<id>", "preview", "editor", "files", or "" (plain shell).
  const [paneAssign, setPaneAssign] = useState<Record<number, string>>({});
  const newTab = useWorkspaceStore((s) => s.newTab);
  const agents = useKanbanStore((s) => s.agents);

  const reset = () => {
    setOpen(false);
    setStep("template");
    setChosen(null);
    setProjectPath("");
    setPaneAssign({});
  };

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

    // Preview panes need projectPath in payload.root for FileBrowser /
    // payload.projectPath for Preview. Stamp it now.
    const finalPresets = presets.map((p) =>
      p.kind === "preview" && projectPath
        ? { ...p, spawnCwd: undefined } // preview pane doesn't spawn a shell
        : p,
    );

    const tabId = newTab(chosen.panes, chosen.label, finalPresets);

    // Post-create: write extra payload for non-terminal kinds (root for files,
    // projectPath for preview) since PanePreset only carries spawn fields.
    if (projectPath) {
      const tab = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
      if (tab) {
        const setPanePayload = useWorkspaceStore.getState().setPanePayload;
        Object.values(tab.panes).forEach((p) => {
          if (p.kind === "preview") setPanePayload(tab.id, p.id, { projectPath });
          if (p.kind === "filebrowser") setPanePayload(tab.id, p.id, { root: projectPath });
        });
      }
    }
    reset();
  };

  const pickProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") setProjectPath(selected);
  };

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)} title="New workspace (Cmd+T)">
        + Workspace
      </button>
      {open && (
        <div className="modal-backdrop" onClick={reset}>
          <div className="modal wide" onClick={(e) => e.stopPropagation()}>
            {step === "template" && (
              <>
                <div className="modal-title">New workspace</div>
                <div className="modal-sub">
                  Pick a layout. Next you can assign an AI agent to each pane —
                  all panes spawn and fire their agent in parallel.
                </div>
                <div className="template-grid">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      className="template-card"
                      onClick={() => {
                        setChosen(t);
                        if (t.panes === 1) {
                          // Skip agent step for single-pane templates and go straight in.
                          setStep("agents");
                        } else {
                          setStep("agents");
                        }
                      }}
                    >
                      <TemplatePreview panes={t.panes} />
                      <div className="template-label">{t.label}</div>
                      <div className="template-sub">{t.panes} pane{t.panes === 1 ? "" : "s"}</div>
                    </button>
                  ))}
                </div>
                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={reset}>Cancel</button>
                </div>
              </>
            )}

            {step === "agents" && chosen && (
              <>
                <div className="modal-title">Agents — {chosen.label}</div>
                <div className="modal-sub">
                  Pick an agent for each pane (or leave as <em>Plain shell</em>).
                  Optionally point the workspace at a project folder.
                </div>

                <div className="form-row">
                  <label>Project folder (optional)</label>
                  <div className="form-row-inline">
                    <input
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
                          <option value="preview">◉ Live preview</option>
                          <option value="editor">✎ Editor</option>
                          <option value="files">▣ File browser</option>
                        </optgroup>
                        {agents.length > 0 && (
                          <optgroup label="Agents">
                            {agents.map((a) => (
                              <option key={a.id} value={`agent:${a.id}`}>✦ {a.name}</option>
                            ))}
                          </optgroup>
                        )}
                      </select>
                    </div>
                  ))}
                </div>

                <div className="modal-actions">
                  <button className="btn btn-ghost" onClick={() => setStep("template")}>← Back</button>
                  <div style={{ flex: 1 }} />
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      // skip agents
                      newTab(chosen.panes, chosen.label, projectPath
                        ? Array.from({ length: chosen.panes }, () => ({ spawnCwd: projectPath }))
                        : undefined);
                      reset();
                    }}
                  >
                    Skip agents
                  </button>
                  <button className="btn btn-primary" onClick={launch}>Launch</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
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

// Empty marker export so Vite tree-shakes the trigger when unused.
export function TemplatePicker() {
  return null;
}
