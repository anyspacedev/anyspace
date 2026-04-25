import { useState } from "react";
import { useKanbanStore } from "../../stores/kanbanStore";
import type { Agent } from "../../lib/types";

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
  const [draft, setDraft] = useState<Omit<Agent, "id">>(BLANK);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = editingId ? agents.find((a) => a.id === editingId) : null;
  const current = editing ?? draft;

  const save = async () => {
    if (!current.name || !current.command) return;
    if (editingId) {
      await updateAgent(editingId, current);
    } else {
      await createAgent(current);
    }
    setDraft(BLANK);
    setEditingId(null);
  };

  return (
    <div className="agent-manager">
      <div className="agent-list">
        <div className="section-title">Agents</div>
        {agents.map((a) => (
          <div
            key={a.id}
            className={"agent-row" + (a.id === editingId ? " active" : "")}
            onClick={() => setEditingId(a.id)}
          >
            <div className="agent-row-name">{a.name}</div>
            <div className="agent-row-cmd">{a.command}</div>
          </div>
        ))}
        <button
          className="btn btn-ghost agent-new"
          onClick={() => { setEditingId(null); setDraft(BLANK); }}
        >
          + New agent
        </button>
      </div>
      <div className="agent-form">
        <div className="section-title">{editing ? "Edit agent" : "New agent"}</div>
        <div className="form-row">
          <label>Name</label>
          <input
            value={current.name}
            onChange={(e) => editing
              ? updateLocal({ name: e.target.value })
              : setDraft((d) => ({ ...d, name: e.target.value }))}
          />
        </div>
        <div className="form-row">
          <label>Command</label>
          <input
            value={current.command}
            placeholder="e.g. claude --resume {task_file}"
            onChange={(e) => editing
              ? updateLocal({ command: e.target.value })
              : setDraft((d) => ({ ...d, command: e.target.value }))}
          />
          <div className="hint muted">
            Use <code>{"{task_file}"}</code> placeholder or <code>$TEAMSHIP_TASK_FILE</code> env var.
          </div>
        </div>
        <div className="form-row">
          <label>System prompt</label>
          <textarea
            value={current.systemPrompt}
            rows={4}
            onChange={(e) => editing
              ? updateLocal({ systemPrompt: e.target.value })
              : setDraft((d) => ({ ...d, systemPrompt: e.target.value }))}
          />
        </div>
        <div className="modal-actions">
          {editing && (
            <button
              className="btn btn-danger"
              onClick={async () => { await deleteAgent(editing.id); setEditingId(null); }}
            >
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={save}>
            {editing ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );

  function updateLocal(patch: Partial<Agent>) {
    if (!editing) return;
    void updateAgent(editing.id, patch);
  }
}
