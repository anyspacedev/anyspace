import { useEffect, useId, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useFocusReturn } from "../../lib/useFocusReturn";
import { useFocusTrap } from "../../lib/useFocusTrap";
import type { Task } from "../../lib/types";
import { Icon } from "../ui/Icon";
import { Select } from "../ui/Select";

export function TaskEditor({ task, onClose }: { task?: Task; onClose: () => void }) {
  useFocusReturn();
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef);
  const create = useKanbanStore((s) => s.createTask);
  const update = useKanbanStore((s) => s.updateTask);
  const remove = useKanbanStore((s) => s.deleteTask);
  const agents = useKanbanStore((s) => s.agents);

  const [title, setTitle] = useState(task?.title ?? "");
  const [body, setBody] = useState(task?.body ?? "");
  const [agentId, setAgentId] = useState(task?.agentId ?? "");
  const [projectPath, setProjectPath] = useState(task?.projectPath ?? "");

  const titleId = useId();
  const titleInputId = useId();
  const bodyInputId = useId();
  const agentSelectId = useId();
  const projectInputId = useId();

  // Dirty if user has typed anything (new task) or changed something (edit).
  const dirty = task
    ? title !== (task.title ?? "") ||
      body !== (task.body ?? "") ||
      agentId !== (task.agentId ?? "") ||
      projectPath !== (task.projectPath ?? "")
    : title.trim().length > 0 || body.trim().length > 0;

  const tryClose = () => {
    if (dirty) {
      const ok = window.confirm("Discard changes?");
      if (!ok) return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        tryClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dirty]);

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
    <div className="modal-backdrop" onClick={tryClose}>
      <div
        ref={modalRef}
        className="modal task-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId} className="modal-title">{task ? "Edit task" : "New task"}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={tryClose}
            aria-label="Close"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={titleInputId}>
            <Icon name="file-edit" size={12} />
            <span>Title</span>
          </label>
          <input id={titleInputId} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={bodyInputId}>
            <Icon name="list-checks" size={12} />
            <span>Body</span>
          </label>
          <textarea id={bodyInputId} value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={agentSelectId}>
            <Icon name="sparkles" size={12} />
            <span>Agent</span>
          </label>
          <Select id={agentSelectId} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            <option value="">— none —</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </Select>
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={projectInputId}>
            <Icon name="folder" size={12} />
            <span>Project path</span>
          </label>
          <div className="form-row-inline">
            <input id={projectInputId} value={projectPath} onChange={(e) => setProjectPath(e.target.value)} placeholder="optional" />
            <button className="btn btn-ghost btn-with-icon" onClick={pickProject}>
              <Icon name="folder" size={14} />
              <span>Pick…</span>
            </button>
          </div>
        </div>
        <div className="modal-actions">
          {task && (
            <button className="btn btn-danger" onClick={async () => { await remove(task.id); onClose(); }}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={tryClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
