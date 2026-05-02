CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  project_path TEXT NOT NULL,
  goal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','archived')),
  tab_id TEXT,
  team_dir TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_teams_status ON teams(status, updated_at DESC);

CREATE TABLE IF NOT EXISTS team_agents (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  pane_id TEXT,
  label TEXT NOT NULL,
  role TEXT NOT NULL,
  agent_id TEXT NOT NULL REFERENCES agents(id),
  system_prompt_override TEXT,
  ordinal REAL NOT NULL,
  UNIQUE (team_id, label)
);

CREATE INDEX IF NOT EXISTS idx_team_agents_team ON team_agents(team_id, ordinal);

CREATE TABLE IF NOT EXISTS team_skills (
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  PRIMARY KEY (team_id, skill_id)
);

CREATE TABLE IF NOT EXISTS team_attachments (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_team_attachments_team ON team_attachments(team_id);
