CREATE TABLE IF NOT EXISTS super_agent_sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  system_prompt_override TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_super_agent_sessions_updated
  ON super_agent_sessions(updated_at DESC);

CREATE TABLE IF NOT EXISTS super_agent_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES super_agent_sessions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user','assistant','tool','system')),
  content TEXT NOT NULL DEFAULT '',
  tool_calls_json TEXT,
  tool_results_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_super_agent_messages_session
  ON super_agent_messages(session_id, ordinal);
