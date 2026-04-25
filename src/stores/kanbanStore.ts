import { create } from "zustand";
import Database from "@tauri-apps/plugin-sql";
import type { Agent, Task } from "../lib/types";

let dbPromise: Promise<Database> | null = null;
function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:teamship.db");
  }
  return dbPromise;
}

const newId = () => Math.random().toString(36).slice(2, 12);
const now = () => Date.now();

type Row = Record<string, unknown>;
const rowToTask = (r: Row): Task => ({
  id: String(r.id),
  title: String(r.title),
  body: String(r.body ?? ""),
  column: r.column_name as Task["column"],
  agentId: r.agent_id ? String(r.agent_id) : undefined,
  projectPath: r.project_path ? String(r.project_path) : undefined,
  ordinal: Number(r.ordinal),
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});
const rowToAgent = (r: Row): Agent => ({
  id: String(r.id),
  name: String(r.name),
  command: String(r.command),
  systemPrompt: String(r.system_prompt ?? ""),
  envJson: String(r.env_json ?? "{}"),
});

type KanbanState = {
  loaded: boolean;
  tasks: Task[];
  agents: Agent[];
  load: () => Promise<void>;
  createTask: (input: Partial<Task> & { title: string }) => Promise<Task>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  moveTask: (id: string, column: Task["column"], ordinal: number) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  createAgent: (input: Omit<Agent, "id">) => Promise<Agent>;
  updateAgent: (id: string, patch: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
};

export const useKanbanStore = create<KanbanState>((set, get) => ({
  loaded: false,
  tasks: [],
  agents: [],
  load: async () => {
    const db = await getDb();
    const taskRows = await db.select<Row[]>(
      "SELECT * FROM tasks ORDER BY column_name, ordinal",
    );
    const agentRows = await db.select<Row[]>("SELECT * FROM agents ORDER BY name");
    set({
      tasks: taskRows.map(rowToTask),
      agents: agentRows.map(rowToAgent),
      loaded: true,
    });
  },
  createTask: async (input) => {
    const db = await getDb();
    const t: Task = {
      id: newId(),
      title: input.title,
      body: input.body ?? "",
      column: input.column ?? "todo",
      agentId: input.agentId,
      projectPath: input.projectPath,
      ordinal: input.ordinal ?? now(),
      createdAt: now(),
      updatedAt: now(),
    };
    await db.execute(
      "INSERT INTO tasks (id, title, body, column_name, agent_id, project_path, ordinal, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [t.id, t.title, t.body, t.column, t.agentId ?? null, t.projectPath ?? null, t.ordinal, t.createdAt, t.updatedAt],
    );
    set((s) => ({ tasks: [...s.tasks, t] }));
    return t;
  },
  updateTask: async (id, patch) => {
    const db = await getDb();
    const existing = get().tasks.find((t) => t.id === id);
    if (!existing) return;
    const merged: Task = { ...existing, ...patch, updatedAt: now() };
    await db.execute(
      "UPDATE tasks SET title=?, body=?, column_name=?, agent_id=?, project_path=?, ordinal=?, updated_at=? WHERE id=?",
      [
        merged.title,
        merged.body,
        merged.column,
        merged.agentId ?? null,
        merged.projectPath ?? null,
        merged.ordinal,
        merged.updatedAt,
        id,
      ],
    );
    set((s) => ({ tasks: s.tasks.map((t) => (t.id === id ? merged : t)) }));
  },
  moveTask: async (id, column, ordinal) => {
    await get().updateTask(id, { column, ordinal });
  },
  deleteTask: async (id) => {
    const db = await getDb();
    await db.execute("DELETE FROM tasks WHERE id=?", [id]);
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
  },
  createAgent: async (input) => {
    const db = await getDb();
    const a: Agent = { id: newId(), ...input };
    await db.execute(
      "INSERT INTO agents (id, name, command, system_prompt, env_json) VALUES (?,?,?,?,?)",
      [a.id, a.name, a.command, a.systemPrompt, a.envJson],
    );
    set((s) => ({ agents: [...s.agents, a] }));
    return a;
  },
  updateAgent: async (id, patch) => {
    const db = await getDb();
    const existing = get().agents.find((a) => a.id === id);
    if (!existing) return;
    const merged: Agent = { ...existing, ...patch };
    await db.execute(
      "UPDATE agents SET name=?, command=?, system_prompt=?, env_json=? WHERE id=?",
      [merged.name, merged.command, merged.systemPrompt, merged.envJson, id],
    );
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? merged : a)) }));
  },
  deleteAgent: async (id) => {
    const db = await getDb();
    await db.execute("DELETE FROM agents WHERE id=?", [id]);
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
  },
}));
