/**
 * Pi-flavored persistence for Super Agent. Phase 3 of the pi-agent-framework
 * refactor.
 *
 * Reads/writes rows shaped after pi-agent-core's `AgentMessage` union, stored
 * in `super_agent_messages_v2` as one JSON blob per ordinal. Legacy rows in
 * `super_agent_messages` (migrations 005/006) are migrated lazily the first
 * time a session is touched in the new build:
 *
 *   1. Check `super_agent_sessions.pi_version`. If non-null, trust v2.
 *   2. Else wipe any partial v2 rows for the session, convert legacy rows in
 *      memory, bulk-insert into v2, set `pi_version` to mark complete.
 *
 * That `pi_version` sentinel survives partial-write crashes — a half-applied
 * migration leaves `pi_version` null, so the next load wipes-and-retries.
 *
 * Legacy `super_agent_messages` is never touched. Phase 6 cleanup drops it
 * once we're confident the new path is stable.
 */

import Database from "@tauri-apps/plugin-sql";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ThinkingContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";

const PI_PERSISTENCE_VERSION = "0.74.0";

let dbPromise: Promise<Database> | null = null;
async function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = Database.load("sqlite:anyspace.db");
  return dbPromise;
}

const newId = () => Math.random().toString(36).slice(2, 12);
const nowMs = () => Date.now();

const ZERO_USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type LegacyRow = {
  id: unknown;
  session_id: unknown;
  ordinal: unknown;
  role: unknown;
  content: unknown;
  tool_calls_json: unknown;
  tool_results_json: unknown;
  reasoning_content: unknown;
  created_at: unknown;
};

type V2Row = {
  id: unknown;
  session_id: unknown;
  ordinal: unknown;
  role: unknown;
  message_json: unknown;
  created_at: unknown;
};

function messageTimestamp(msg: AgentMessage): number {
  const ts = (msg as { timestamp?: unknown }).timestamp;
  return typeof ts === "number" ? ts : nowMs();
}

/** Build `callId → toolName` from legacy assistant rows so backfilled
 *  `ToolResultMessage`s carry a useful `toolName` instead of "unknown". */
function legacyToolNames(rows: LegacyRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.role !== "assistant" || !r.tool_calls_json) continue;
    try {
      const calls = JSON.parse(String(r.tool_calls_json)) as {
        id?: string;
        name?: string;
      }[];
      for (const c of calls) {
        if (c?.id && c?.name) map.set(c.id, c.name);
      }
    } catch {
      // skip malformed
    }
  }
  return map;
}

function legacyRowToAgentMessages(
  r: LegacyRow,
  toolNames: Map<string, string>,
): AgentMessage[] {
  const ts = Number(r.created_at) || nowMs();
  const role = String(r.role);

  if (role === "user") {
    const msg: UserMessage = {
      role: "user",
      content: String(r.content ?? ""),
      timestamp: ts,
    };
    return [msg];
  }

  if (role === "assistant") {
    const content: (TextContent | ThinkingContent | ToolCall)[] = [];
    const reasoning = r.reasoning_content ? String(r.reasoning_content) : "";
    if (reasoning) {
      content.push({ type: "thinking", thinking: reasoning });
    }
    const text = r.content ? String(r.content) : "";
    if (text) {
      content.push({ type: "text", text });
    }
    if (r.tool_calls_json) {
      try {
        const calls = JSON.parse(String(r.tool_calls_json)) as {
          id: string;
          name: string;
          arguments?: Record<string, unknown>;
        }[];
        for (const c of calls) {
          content.push({
            type: "toolCall",
            id: c.id,
            name: c.name,
            arguments: c.arguments ?? {},
          });
        }
      } catch {
        // skip malformed tool_calls_json
      }
    }
    const msg: AssistantMessage = {
      role: "assistant",
      content,
      api: "unknown",
      provider: "unknown",
      model: "unknown",
      usage: ZERO_USAGE,
      stopReason: content.some((b) => b.type === "toolCall") ? "toolUse" : "stop",
      timestamp: ts,
    };
    return [msg];
  }

  if (role === "tool") {
    if (!r.tool_results_json) return [];
    let results: {
      callId: string;
      resultText?: string;
      status?: string;
    }[] = [];
    try {
      results = JSON.parse(String(r.tool_results_json));
    } catch {
      return [];
    }
    return results.map((tr): ToolResultMessage => {
      // Legacy images stored on-disk paths only; they were re-read at
      // history-build time as base64. Old /tmp paths from prior sessions may
      // no longer exist, so backfill drops image content. Phase 4 tool runs
      // attach fresh base64 image data on new tool results.
      const blocks: (TextContent | ImageContent)[] = [
        { type: "text", text: tr.resultText ?? "" },
      ];
      const isError =
        tr.status === "error" ||
        tr.status === "disabled" ||
        tr.status === "skipped";
      return {
        role: "toolResult",
        toolCallId: tr.callId,
        toolName: toolNames.get(tr.callId) ?? "unknown",
        content: blocks,
        isError,
        timestamp: ts,
      };
    });
  }

  // role === "system": display-only handoff markers (Operator inbox).
  // Skip during backfill — they were never round-tripped to the model.
  return [];
}

async function loadV2(sessionId: string): Promise<AgentMessage[]> {
  const db = await getDb();
  const rows = await db.select<V2Row[]>(
    "SELECT id, session_id, ordinal, role, message_json, created_at FROM super_agent_messages_v2 WHERE session_id = ? ORDER BY ordinal ASC",
    [sessionId],
  );
  const out: AgentMessage[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(String(r.message_json)) as AgentMessage);
    } catch {
      // skip malformed row rather than fail the whole session
    }
  }
  return out;
}

async function backfillFromLegacy(sessionId: string): Promise<AgentMessage[]> {
  const db = await getDb();
  const rows = await db.select<LegacyRow[]>(
    "SELECT id, session_id, ordinal, role, content, tool_calls_json, tool_results_json, reasoning_content, created_at FROM super_agent_messages WHERE session_id = ? ORDER BY ordinal ASC",
    [sessionId],
  );
  if (rows.length === 0) return [];
  const toolNames = legacyToolNames(rows);
  const messages: AgentMessage[] = [];
  for (const r of rows) {
    messages.push(...legacyRowToAgentMessages(r, toolNames));
  }
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    await db.execute(
      "INSERT INTO super_agent_messages_v2 (id, session_id, ordinal, role, message_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      [newId(), sessionId, i, msg.role, JSON.stringify(msg), messageTimestamp(msg)],
    );
  }
  return messages;
}

/** Idempotent: marks the session as migrated and converts legacy rows
 *  exactly once. Safe to call before every load/append. */
async function ensureMigrated(sessionId: string): Promise<void> {
  const db = await getDb();
  const sessRows = await db.select<{ pi_version: unknown }[]>(
    "SELECT pi_version FROM super_agent_sessions WHERE id = ?",
    [sessionId],
  );
  if (sessRows.length === 0) return; // unknown session — let the caller fail
  if (sessRows[0].pi_version != null) return; // already migrated

  // Wipe any half-applied v2 rows from a prior crashed migration, then redo.
  await db.execute(
    "DELETE FROM super_agent_messages_v2 WHERE session_id = ?",
    [sessionId],
  );
  await backfillFromLegacy(sessionId);
  await db.execute(
    "UPDATE super_agent_sessions SET pi_version = ? WHERE id = ?",
    [PI_PERSISTENCE_VERSION, sessionId],
  );
}

export async function loadAgentMessages(sessionId: string): Promise<AgentMessage[]> {
  await ensureMigrated(sessionId);
  return loadV2(sessionId);
}

export async function appendAgentMessage(
  sessionId: string,
  msg: AgentMessage,
): Promise<number> {
  await ensureMigrated(sessionId);
  const db = await getDb();
  const rows = await db.select<{ ord: unknown }[]>(
    "SELECT COALESCE(MAX(ordinal), -1) + 1 AS ord FROM super_agent_messages_v2 WHERE session_id = ?",
    [sessionId],
  );
  const ordinal = Number(rows[0]?.ord ?? 0);
  const ts = messageTimestamp(msg);
  await db.execute(
    "INSERT INTO super_agent_messages_v2 (id, session_id, ordinal, role, message_json, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [newId(), sessionId, ordinal, msg.role, JSON.stringify(msg), ts],
  );
  await db.execute(
    "UPDATE super_agent_sessions SET updated_at = ? WHERE id = ?",
    [ts, sessionId],
  );
  return ordinal;
}

export async function updateAgentMessage(
  sessionId: string,
  ordinal: number,
  msg: AgentMessage,
): Promise<void> {
  const db = await getDb();
  const ts = messageTimestamp(msg);
  await db.execute(
    "UPDATE super_agent_messages_v2 SET role = ?, message_json = ?, created_at = ? WHERE session_id = ? AND ordinal = ?",
    [msg.role, JSON.stringify(msg), ts, sessionId, ordinal],
  );
}

export async function deleteSessionMessages(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "DELETE FROM super_agent_messages_v2 WHERE session_id = ?",
    [sessionId],
  );
}

/** Internal helpers exposed for testing/inspection only. */
export const __internal = { legacyRowToAgentMessages, legacyToolNames };
