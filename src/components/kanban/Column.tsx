import { useDroppable } from "@dnd-kit/core";
import type { Agent, Task } from "../../lib/types";
import { Card } from "./Card";

const COLUMN_TONE: Record<Task["column"], string> = {
  todo: "var(--info)",
  in_progress: "var(--warning)",
  in_review: "var(--accent)",
  complete: "var(--success)",
};

const COLUMN_HINT: Record<Task["column"], string> = {
  todo: "Add a task to start",
  in_progress: "Drag a task here when you start",
  in_review: "Drag a task here when ready to review",
  complete: "Drag a task here when done",
};

export function Column({
  id,
  title,
  tasks,
  agents,
  onEdit,
  onRun,
}: {
  id: Task["column"];
  title: string;
  tasks: Task[];
  agents: Agent[];
  onEdit: (t: Task) => void;
  onRun: (t: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const tone = COLUMN_TONE[id];
  return (
    <div
      ref={setNodeRef}
      className={"kanban-col" + (isOver ? " hover" : "")}
      style={{ "--col-tone": tone } as React.CSSProperties}
    >
      <div className="kanban-col-head">
        <span className="kanban-col-title">
          <span className="kanban-col-dot" />
          {title}
        </span>
        <span className="kanban-col-count">{tasks.length}</span>
      </div>
      <div className="kanban-col-body scrollbar">
        {tasks.map((t) => {
          const agent = agents.find((a) => a.id === t.agentId);
          return (
            <Card
              key={t.id}
              task={t}
              agent={agent}
              onEdit={() => onEdit(t)}
              onRun={() => onRun(t)}
            />
          );
        })}
        {tasks.length === 0 && (
          <div className="kanban-empty">{COLUMN_HINT[id]}</div>
        )}
      </div>
    </div>
  );
}
