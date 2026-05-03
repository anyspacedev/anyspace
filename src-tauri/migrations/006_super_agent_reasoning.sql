-- DeepSeek (and other hybrid-thinking endpoints) require the assistant's
-- `reasoning_content` from the previous turn to be passed back on follow-up
-- requests. Persist it alongside content so history rebuilds round-trip it.
ALTER TABLE super_agent_messages ADD COLUMN reasoning_content TEXT;
