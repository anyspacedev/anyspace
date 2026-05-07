import { useEffect, useId, useState } from "react";
import { useKanbanStore } from "../../stores/kanbanStore";
import type { Agent } from "../../lib/types";
import { Icon } from "../ui/Icon";
import { EnvEditor } from "./EnvEditor";
import { AgentExamples, type AgentExample } from "./AgentExamples";

const BLANK: Omit<Agent, "id"> = {
  name: "",
  command: "",
  systemPrompt: "",
  envJson: "{}",
};

export function AgentManager() {
  const agents = useKanbanStore((s) => s.agents);
  const createAgent = useKanbanStore((s) => s.createAgent);
  const updateAgent = useKanbanStore((s) => s.updateAgent);
  const deleteAgent = useKanbanStore((s) => s.deleteAgent);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Omit<Agent, "id">>(BLANK);
  const [dirty, setDirty] = useState(false);

  const nameId = useId();
  const commandId = useId();
  const systemPromptId = useId();

  // When the user picks a different agent in the list, populate the form from it.
  useEffect(() => {
    if (editingId === null) {
      setDraft(BLANK);
      setDirty(false);
      return;
    }
    const agent = agents.find((a) => a.id === editingId);
    if (agent) {
      const { id: _id, ...rest } = agent;
      void _id;
      setDraft(rest);
      setDirty(false);
    }
  }, [editingId, agents]);

  const update = (patch: Partial<Omit<Agent, "id">>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setDirty(true);
  };

  const applyExample = (ex: AgentExample) => {
    setDraft({
      name: ex.name,
      command: ex.command,
      systemPrompt: ex.systemPrompt,
      envJson: ex.envJson,
    });
    setDirty(true);
  };

  // Show the examples column when starting fresh: no agent picked, no name typed.
  const showExamples = editingId === null && !draft.name && !draft.command;

  const save = async () => {
    if (!draft.name || !draft.command) return;
    if (editingId) {
      await updateAgent(editingId, draft);
    } else {
      const created = await createAgent(draft);
      setEditingId(created.id);
    }
    setDirty(false);
  };

  const onDelete = async () => {
    if (!editingId) return;
    await deleteAgent(editingId);
    setEditingId(null);
  };

  return (
    <div className={"agent-manager" + (showExamples ? " agent-manager--has-examples" : "")}>
      <div className="agent-list">
        <div className="section-title">Agents</div>
        {agents.length === 0 && (
          <div className="agent-list-empty">
            <Icon name="sparkles" size={18} />
            <div>
              No agents yet. Pick an example on the right to seed the form,
              or fill it in by hand.
            </div>
          </div>
        )}
        {agents.map((a) => (
          <div
            key={a.id}
            className={"agent-row" + (a.id === editingId ? " active" : "")}
            onClick={() => setEditingId(a.id)}
          >
            <div className="agent-row-icon">
              <Icon name="terminal" size={14} />
            </div>
            <div className="agent-row-text">
              <div className="agent-row-name">{a.name}</div>
              <div className="agent-row-cmd">{a.command}</div>
            </div>
          </div>
        ))}
        <button
          className="btn btn-ghost agent-new btn-with-icon"
          onClick={() => setEditingId(null)}
        >
          <Icon name="plus" size={14} />
          <span>New agent</span>
        </button>
      </div>
      <div className="agent-form">
        <div className="section-title">{editingId ? "Edit agent" : "New agent"}</div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={nameId}>
            <Icon name="file-edit" size={12} />
            <span>Name</span>
          </label>
          <input
            id={nameId}
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={commandId}>
            <Icon name="terminal" size={12} />
            <span>Command</span>
          </label>
          <input
            id={commandId}
            value={draft.command}
            placeholder="e.g. claude --resume {task_file}"
            onChange={(e) => update({ command: e.target.value })}
            spellCheck={false}
          />
          <div className="hint">
            Spawned in a terminal pane when Run Task fires.{" "}
            <code>{"{task_file}"}</code> expands to the rendered task body
            on disk; <code>$TEAMSHIP_TASK_FILE</code> is set in the agent's env
            for tools that prefer reading from an env var.
          </div>
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={systemPromptId}>
            <Icon name="sparkles" size={12} />
            <span>System prompt</span>
            <span className="form-row-tag">optional</span>
          </label>
          <textarea
            id={systemPromptId}
            value={draft.systemPrompt}
            rows={4}
            onChange={(e) => update({ systemPrompt: e.target.value })}
            placeholder="Prepended to the task body before the agent runs. Useful for setting persona or constraints (e.g. &quot;You are a security-focused reviewer.&quot;)."
          />
        </div>
        <div className="form-row">
          <label className="label-with-icon">
            <Icon name="terminal" size={12} />
            <span>Environment variables</span>
            <span className="form-row-tag">optional</span>
          </label>
          <EnvEditor
            envJson={draft.envJson}
            onChange={(next) => update({ envJson: next })}
          />
        </div>
        <div className="modal-actions">
          {editingId && (
            <button className="btn btn-danger btn-with-icon" onClick={onDelete}>
              <Icon name="x" size={14} />
              <span>Delete</span>
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary btn-with-icon"
            disabled={!dirty || !draft.name || !draft.command}
            onClick={save}
          >
            <Icon name={editingId ? "check" : "plus"} size={14} />
            <span>{editingId ? (dirty ? "Save changes" : "Saved") : "Create"}</span>
          </button>
        </div>
      </div>
      {showExamples && <AgentExamples onPick={applyExample} />}
    </div>
  );
}
