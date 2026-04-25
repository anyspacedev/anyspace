import { useState } from "react";
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
import { agentLaunch } from "../../lib/tauri";
import { useWorkspaceStore } from "../../stores/workspaceStore";

export function KanbanBoard() {
  const tasks = useKanbanStore((s) => s.tasks);
  const agents = useKanbanStore((s) => s.agents);
  const moveTask = useKanbanStore((s) => s.moveTask);
  const newTab = useWorkspaceStore((s) => s.newTab);
  const tabs = useWorkspaceStore((s) => s.tabs);
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const setView = useWorkspaceStore((s) => s.setView);

  const [editing, setEditing] = useState<Task | null>(null);
  const [creating, setCreating] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

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
    const agent = agents.find((a) => a.id === task.agentId);
    if (!agent) {
      alert("Pick an agent for this task first.");
      return;
    }
    const plan = await agentLaunch({
      agentCommand: agent.command,
      taskTitle: task.title,
      taskBody: task.body,
      systemPrompt: agent.systemPrompt,
    });
    // Spawn a new workspace tab with a single terminal, queue the agent command.
    const tabId = newTab(1, `▶ ${task.title}`);
    // After tab created, set its single pane's payload.
    const created = tabs.find((t) => t.id === tabId) ?? useWorkspaceStore.getState().tabs.find((t) => t.id === tabId);
    if (created) {
      const paneId = Object.keys(created.panes)[0];
      setPanePayload(tabId, paneId, {
        pendingCommand: plan.command,
        spawnEnv: plan.env,
        spawnCwd: task.projectPath,
        title: `▶ ${task.title}`,
      });
    }
    setActiveTab(tabId);
    setView("workspace");
  };

  return (
    <div className="kanban">
      <div className="kanban-toolbar">
        <button className="btn" onClick={() => setCreating(true)}>+ New task</button>
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
    </div>
  );
}
