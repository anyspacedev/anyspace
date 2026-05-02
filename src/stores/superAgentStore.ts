import { create } from "zustand";
import Database from "@tauri-apps/plugin-sql";

let dbPromise: Promise<Database> | null = null;
function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:teamship.db");
  }
  return dbPromise;
}

const newId = () => Math.random().toString(36).slice(2, 12);
const now = () => Date.now();

export type Role = "user" | "assistant" | "tool" | "system";

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResultStatus = "queued" | "running" | "ok" | "error" | "disabled" | "skipped";

export type ToolResult = {
  callId: string;
  status: ToolResultStatus;
  /** Raw result payload — JSON-stringified body the model sees. */
  resultText: string;
  /** Wall-clock ms; populated on transition out of running. */
  durationMs?: number;
  /** Error message when status === "error" */
  errorMessage?: string;
};

export type Message = {
  id: string;
  sessionId: string;
  ordinal: number;
  role: Role;
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
  createdAt: number;
  /** Set by the runner while a token stream is in flight; not persisted. */
  streaming?: boolean;
};

export type Session = {
  id: string;
  name: string;
  systemPromptOverride?: string;
  createdAt: number;
  updatedAt: number;
};

type Row = Record<string, unknown>;

const rowToSession = (r: Row): Session => ({
  id: String(r.id),
  name: String(r.name),
  systemPromptOverride: r.system_prompt_override ? String(r.system_prompt_override) : undefined,
  createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at),
});

const rowToMessage = (r: Row): Message => ({
  id: String(r.id),
  sessionId: String(r.session_id),
  ordinal: Number(r.ordinal),
  role: r.role as Role,
  content: String(r.content ?? ""),
  toolCalls: r.tool_calls_json ? JSON.parse(String(r.tool_calls_json)) : undefined,
  toolResults: r.tool_results_json ? JSON.parse(String(r.tool_results_json)) : undefined,
  createdAt: Number(r.created_at),
});

type SuperAgentState = {
  loaded: boolean;
  sessions: Session[];
  activeSessionId: string | null;
  messagesBySession: Record<string, Message[]>;
  /** Panel docked alongside the workspace (side-rail mode). Persisted. */
  panelOpen: boolean;
  /** Emergency brake — when true, tool calls land as queued cards. Not persisted. */
  pauseToolCalls: boolean;
  /** Streams in flight; cancellable via the runner. Not persisted. */
  activeStreamId: string | null;

  load: () => Promise<void>;
  setPanelOpen: (open: boolean) => void;
  setPauseToolCalls: (paused: boolean) => void;
  setActiveStreamId: (id: string | null) => void;

  createSession: (name?: string) => Promise<Session>;
  renameSession: (sessionId: string, name: string) => Promise<void>;
  deleteSession: (sessionId: string) => Promise<void>;
  setActiveSession: (sessionId: string | null) => void;

  loadMessages: (sessionId: string) => Promise<void>;
  appendMessage: (msg: Omit<Message, "id" | "ordinal" | "createdAt">) => Promise<Message>;
  updateMessage: (sessionId: string, messageId: string, patch: Partial<Message>) => Promise<void>;
  resetSession: (sessionId: string) => Promise<void>;
};

export const useSuperAgentStore = create<SuperAgentState>((set, get) => ({
  loaded: false,
  sessions: [],
  activeSessionId: null,
  messagesBySession: {},
  panelOpen: false,
  pauseToolCalls: false,
  activeStreamId: null,

  load: async () => {
    const db = await getDb();
    const rows = await db.select<Row[]>(
      "SELECT * FROM super_agent_sessions ORDER BY updated_at DESC",
    );
    set({ sessions: rows.map(rowToSession), loaded: true });
  },

  setPanelOpen: (panelOpen) => set({ panelOpen }),
  setPauseToolCalls: (pauseToolCalls) => set({ pauseToolCalls }),
  setActiveStreamId: (activeStreamId) => set({ activeStreamId }),

  createSession: async (name) => {
    const db = await getDb();
    const ts = now();
    const session: Session = {
      id: newId(),
      name: name ?? `Session ${new Date(ts).toLocaleString()}`,
      createdAt: ts,
      updatedAt: ts,
    };
    await db.execute(
      "INSERT INTO super_agent_sessions (id, name, system_prompt_override, created_at, updated_at) VALUES (?,?,?,?,?)",
      [session.id, session.name, null, session.createdAt, session.updatedAt],
    );
    set((s) => ({
      sessions: [session, ...s.sessions],
      activeSessionId: session.id,
      messagesBySession: { ...s.messagesBySession, [session.id]: [] },
    }));
    return session;
  },

  renameSession: async (sessionId, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const db = await getDb();
    const ts = now();
    await db.execute(
      "UPDATE super_agent_sessions SET name=?, updated_at=? WHERE id=?",
      [trimmed, ts, sessionId],
    );
    set((s) => ({
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, name: trimmed, updatedAt: ts } : x,
      ),
    }));
  },

  deleteSession: async (sessionId) => {
    const db = await getDb();
    await db.execute("DELETE FROM super_agent_sessions WHERE id=?", [sessionId]);
    set((s) => {
      const next = { ...s.messagesBySession };
      delete next[sessionId];
      return {
        sessions: s.sessions.filter((x) => x.id !== sessionId),
        messagesBySession: next,
        activeSessionId: s.activeSessionId === sessionId ? null : s.activeSessionId,
      };
    });
  },

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  loadMessages: async (sessionId) => {
    if (get().messagesBySession[sessionId]) return; // already loaded
    const db = await getDb();
    const rows = await db.select<Row[]>(
      "SELECT * FROM super_agent_messages WHERE session_id=? ORDER BY ordinal ASC",
      [sessionId],
    );
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: rows.map(rowToMessage) },
    }));
  },

  appendMessage: async (input) => {
    const db = await getDb();
    const sessionId = input.sessionId;
    const existing = get().messagesBySession[sessionId] ?? [];
    const ordinal = existing.length;
    const ts = now();
    const msg: Message = {
      id: newId(),
      ordinal,
      createdAt: ts,
      ...input,
    };
    await db.execute(
      "INSERT INTO super_agent_messages (id, session_id, ordinal, role, content, tool_calls_json, tool_results_json, created_at) VALUES (?,?,?,?,?,?,?,?)",
      [
        msg.id,
        msg.sessionId,
        msg.ordinal,
        msg.role,
        msg.content,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        msg.toolResults ? JSON.stringify(msg.toolResults) : null,
        msg.createdAt,
      ],
    );
    await db.execute(
      "UPDATE super_agent_sessions SET updated_at=? WHERE id=?",
      [ts, sessionId],
    );
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: [...(s.messagesBySession[sessionId] ?? []), msg],
      },
      sessions: s.sessions.map((x) =>
        x.id === sessionId ? { ...x, updatedAt: ts } : x,
      ),
    }));
    return msg;
  },

  updateMessage: async (sessionId, messageId, patch) => {
    const list = get().messagesBySession[sessionId] ?? [];
    const idx = list.findIndex((m) => m.id === messageId);
    if (idx === -1) return;
    const merged: Message = { ...list[idx], ...patch };
    const db = await getDb();
    await db.execute(
      "UPDATE super_agent_messages SET content=?, tool_calls_json=?, tool_results_json=? WHERE id=?",
      [
        merged.content,
        merged.toolCalls ? JSON.stringify(merged.toolCalls) : null,
        merged.toolResults ? JSON.stringify(merged.toolResults) : null,
        messageId,
      ],
    );
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: list.map((m, i) => (i === idx ? merged : m)),
      },
    }));
  },

  resetSession: async (sessionId) => {
    const db = await getDb();
    await db.execute("DELETE FROM super_agent_messages WHERE session_id=?", [sessionId]);
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionId]: [] },
    }));
  },
}));
