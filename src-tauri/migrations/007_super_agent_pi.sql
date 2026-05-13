-- Phase 3 of the pi-agent-framework refactor. Holds messages in the shape
-- pi-agent-core's `AgentMessage` union expects (text/image/toolCall/
-- toolResult/thinking content blocks bundled into one JSON column per row).
--
-- Backfill from `super_agent_messages` runs lazily in TS the first time a
-- session is opened in the new build; the SQL side is intentionally minimal
-- so we can iterate on conversion logic without further migrations.
--
-- The legacy `super_agent_messages` table stays untouched for safety.

CREATE TABLE IF NOT EXISTS super_agent_messages_v2 (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES super_agent_sessions(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  role TEXT NOT NULL,
  message_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (session_id, ordinal)
);

CREATE INDEX IF NOT EXISTS idx_super_agent_messages_v2_session_ord
  ON super_agent_messages_v2(session_id, ordinal);

ALTER TABLE super_agent_sessions ADD COLUMN pi_version TEXT;
