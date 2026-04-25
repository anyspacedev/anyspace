import { useDraggable } from "@dnd-kit/core";
import type { Agent, Task } from "../../lib/types";
import { Icon } from "../ui/Icon";

export function Card({
  task,
  agent,
  onEdit,
  onRun,
}: {
  task: Task;
  agent?: Agent;
  onEdit: () => void;
  onRun: () => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      className={"kanban-card" + (isDragging ? " dragging" : "")}
      {...attributes}
      {...listeners}
    >
      <div className="kanban-card-title">{task.title}</div>
      {task.body && <div className="kanban-card-body">{task.body.slice(0, 140)}</div>}
      <div className="kanban-card-meta">
        {agent && (
          <span className="agent-pill">
            <Icon name="sparkles" size={11} />
            <span>{agent.name}</span>
          </span>
        )}
        {task.projectPath && (
          <span className="path-pill" title={task.projectPath}>
            <Icon name="folder" size={11} />
            <span>{task.projectPath.split("/").slice(-2).join("/")}</span>
          </span>
        )}
      </div>
      <div className="kanban-card-actions">
        <button className="btn btn-ghost" onClick={(e) => { e.stopPropagation(); onEdit(); }}>Edit</button>
        <button
          className="btn btn-primary btn-with-icon"
          onClick={(e) => { e.stopPropagation(); onRun(); }}
        >
          <Icon name="play" size={12} />
          <span>Run</span>
        </button>
      </div>
    </div>
  );
}
