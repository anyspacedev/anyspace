import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useKanbanStore } from "../../stores/kanbanStore";
import type { Task } from "../../lib/types";
import { Icon } from "../ui/Icon";

export function TaskEditor({ task, onClose }: { task?: Task; onClose: () => void }) {
  const create = useKanbanStore((s) => s.createTask);
  const update = useKanbanStore((s) => s.updateTask);
  const remove = useKanbanStore((s) => s.deleteTask);
  const agents = useKanbanStore((s) => s.agents);

  const [title, setTitle] = useState(task?.title ?? "");
  const [body, setBody] = useState(task?.body ?? "");
  const [agentId, setAgentId] = useState(task?.agentId ?? "");
  const [projectPath, setProjectPath] = useState(task?.projectPath ?? "");

  const save = async () => {
    if (!title.trim()) return;
    if (task) {
      await update(task.id, { title, body, agentId: agentId || undefined, projectPath: projectPath || undefined });
    } else {
      await create({ title, body, agentId: agentId || undefined, projectPath: projectPath || undefined });
    }
    onClose();
  };

  const pickProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") setProjectPath(selected);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal task-editor" onClick={(e) => e.stopPropagation()}>
        <div className="modal-title">{task ? "Edit task" : "New task"}</div>
        <div className="form-row">
          <label>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label>Body</label>
          <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
        </div>
        <div className="form-row">
          <label className="label-with-icon">
            <Icon name="sparkles" size={12} />
            <span>Agent</span>
          </label>
          <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">— none —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label>Project path</label>
          <div className="form-row-inline">
            <input value={projectPath} onChange={(e) => setProjectPath(e.target.value)} placeholder="optional" />
            <button className="btn btn-ghost" onClick={pickProject}>Pick…</button>
          </div>
        </div>
        <div className="modal-actions">
          {task && (
            <button className="btn btn-danger" onClick={async () => { await remove(task.id); onClose(); }}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
