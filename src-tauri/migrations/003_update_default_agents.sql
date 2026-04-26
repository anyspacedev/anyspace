-- Rewrite the seeded agent commands to actually pass the task into the CLI.
-- Only touches rows whose command still matches the original 002_seed value,
-- so user-customized agents are left alone.
UPDATE agents SET command = 'claude "$(cat {task_file})"'
  WHERE id = 'agent-claude' AND command = 'claude';
UPDATE agents SET command = 'codex "$(cat {task_file})"'
  WHERE id = 'agent-codex' AND command = 'codex';
