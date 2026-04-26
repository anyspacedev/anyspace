import { useEffect, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useKanbanStore } from "../../stores/kanbanStore";
import { COLUMNS, COLUMN_LABEL, type Task } from "../../lib/types";
import { Column } from "./Column";
import { TaskEditor } from "./TaskEditor";
import { launchAgent } from "../../lib/agentLauncher";
import { Icon } from "../ui/Icon";

export function KanbanBoard() {
  const tasks = useKanbanStore((s) => s.tasks);
  const agents = useKanbanStore((s) => s.agents);
  const moveTask = useKanbanStore((s) => s.moveTask);

  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const overId = e.over?.id ? String(e.over.id) : null;
    if (!overId) return;
    const targetCol = COLUMNS.find((c) => overId === c) ?? null;
    if (!targetCol) return;
    const colTasks = tasks.filter((t) => t.column === targetCol).sort((a, b) => a.ordinal - b.ordinal);
    const lastOrdinal = colTasks.length ? colTasks[colTasks.length - 1].ordinal : 0;
    void moveTask(id, targetCol, lastOrdinal + 1000);
  };

  const runTask = async (task: Task) => {
    if (!task.agentId) {
      setToast("Pick an agent for this task first.");
      return;
    }
    const tabId = await launchAgent({
      mode: "new-tab",
      agentId: task.agentId,
      taskTitle: task.title,
      taskBody: task.body,
      cwd: task.projectPath,
    });
    if (!tabId) setToast("That agent is no longer available — pick another.");
  };

  return (
    <div className="kanban">
      <div className="kanban-toolbar">
        <button className="btn btn-primary btn-with-icon" onClick={() => setCreating(true)}>
          <Icon name="plus" size={14} />
          <span>New task</span>
        </button>
      </div>
      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="kanban-cols">
          {COLUMNS.map((col) => (
            <Column
              key={col}
              id={col}
              title={COLUMN_LABEL[col]}
              tasks={tasks.filter((t) => t.column === col).sort((a, b) => a.ordinal - b.ordinal)}
              agents={agents}
              onEdit={(t) => setEditing(t)}
              onRun={runTask}
            />
          ))}
        </div>
      </DndContext>
      {creating && <TaskEditor onClose={() => setCreating(false)} />}
      {editing && <TaskEditor task={editing} onClose={() => setEditing(null)} />}
      {toast && (
        <div className="kanban-toast" role="status" aria-live="polite">
          <Icon name="alert-circle" size={14} />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}
