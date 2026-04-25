INSERT OR IGNORE INTO agents (id, name, command, system_prompt, env_json) VALUES
  ('agent-claude', 'Claude Code', 'claude', 'You are a helpful coding assistant.', '{}'),
  ('agent-codex',  'Codex CLI',   'codex',  'You are a helpful coding assistant.', '{}'),
  ('agent-shell',  'Shell (echo task)', 'bash -c "cat $TEAMSHIP_TASK_FILE"', '', '{}');
