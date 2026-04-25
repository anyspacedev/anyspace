import { useEffect, useState } from "react";
import { useKanbanStore } from "../../stores/kanbanStore";
import type { Agent } from "../../lib/types";
import { Icon } from "../ui/Icon";

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
    <div className="agent-manager">
      <div className="agent-list">
        <div className="section-title">Agents</div>
        {agents.length === 0 && (
          <div className="agent-list-empty">
            <Icon name="sparkles" size={18} />
            <div>No agents yet. Create one to launch via task or pane.</div>
          </div>
        )}
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
          <label>Name</label>
          <input
            value={draft.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </div>
        <div className="form-row">
          <label>Command</label>
          <input
            value={draft.command}
            placeholder="e.g. claude --resume {task_file}"
            onChange={(e) => update({ command: e.target.value })}
          />
          <div className="hint muted">
            Use <code>{"{task_file}"}</code> placeholder or <code>$TEAMSHIP_TASK_FILE</code> env var.
          </div>
        </div>
        <div className="form-row">
          <label>System prompt</label>
          <textarea
            value={draft.systemPrompt}
            rows={4}
            onChange={(e) => update({ systemPrompt: e.target.value })}
          />
        </div>
        <div className="modal-actions">
          {editingId && (
            <button className="btn btn-danger" onClick={onDelete}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="btn btn-primary"
            disabled={!dirty || !draft.name || !draft.command}
            onClick={save}
          >
            {editingId ? (dirty ? "Save changes" : "Saved") : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
