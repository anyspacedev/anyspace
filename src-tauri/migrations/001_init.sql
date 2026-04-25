CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  column_name TEXT NOT NULL CHECK (column_name IN ('todo','in_progress','in_review','complete')),
  agent_id TEXT,
  project_path TEXT,
  ordinal REAL NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_column ON tasks(column_name, ordinal);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  system_prompt TEXT NOT NULL DEFAULT '',
  env_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS prompts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  body TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  layout_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
