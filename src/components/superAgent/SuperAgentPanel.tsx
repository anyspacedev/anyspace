import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { useSuperAgentSettingsStore } from "../../stores/superAgentSettingsStore";
import { useSttStore } from "../../stores/sttStore";
import { abortActive, sendUserMessage } from "../../lib/superAgent/runner";
import { Icon } from "../ui/Icon";
import { MessageBubble } from "./MessageBubble";
import { registerSuperAgentInput } from "./inputRegistry";

export function SuperAgentPanel() {
  const sessions = useSuperAgentStore((s) => s.sessions);
  const activeSessionId = useSuperAgentStore((s) => s.activeSessionId);
  const messagesBySession = useSuperAgentStore((s) => s.messagesBySession);
  const pauseToolCalls = useSuperAgentStore((s) => s.pauseToolCalls);
  const setPauseToolCalls = useSuperAgentStore((s) => s.setPauseToolCalls);
  const activeStreamId = useSuperAgentStore((s) => s.activeStreamId);
  const setPanelOpen = useSuperAgentStore((s) => s.setPanelOpen);
  const setActiveSession = useSuperAgentStore((s) => s.setActiveSession);
  const createSession = useSuperAgentStore((s) => s.createSession);
  const renameSession = useSuperAgentStore((s) => s.renameSession);
  const loadMessages = useSuperAgentStore((s) => s.loadMessages);

  const setPanelWidth = useSuperAgentSettingsStore((s) => s.setPanelWidth);
  const savePanelWidth = useSuperAgentSettingsStore((s) => s.savePanelWidth);
  const settings = useSuperAgentSettingsStore((s) => s.settings);
  const sttPhase = useSttStore((s) => s.phase);

  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const prevCountRef = useRef(0);
  const inputId = useId();

  // Register the textarea so STT can route a dictation here when the panel
  // is open but the textarea isn't focused at hotkey-down time.
  useEffect(() => {
    registerSuperAgentInput(textareaRef.current);
    return () => registerSuperAgentInput(null);
  }, []);

  const session = sessions.find((s) => s.id === activeSessionId) ?? null;
  const messages = useMemo(
    () => (activeSessionId ? messagesBySession[activeSessionId] ?? [] : []),
    [activeSessionId, messagesBySession],
  );

  // Load messages lazily when switching sessions.
  useEffect(() => {
    if (activeSessionId && !messagesBySession[activeSessionId]) {
      void loadMessages(activeSessionId);
    }
  }, [activeSessionId, messagesBySession, loadMessages]);

  // Auto-scroll on new messages when at bottom; otherwise track unread.
  useEffect(() => {
    const prev = prevCountRef.current;
    const next = messages.length;
    prevCountRef.current = next;
    if (atBottom) {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
      if (unread !== 0) setUnread(0);
      return;
    }
    const arrived = Math.max(0, next - prev);
    if (arrived > 0) setUnread((u) => u + arrived);
  }, [messages.length, atBottom, unread]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isBottom = distance < 24;
    setAtBottom(isBottom);
    if (isBottom && unread !== 0) setUnread(0);
  };

  const jumpToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAtBottom(true);
    setUnread(0);
  };

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = useSuperAgentSettingsStore.getState().settings.panelWidth;
      const handle = e.currentTarget;
      handle.setPointerCapture(e.pointerId);
      let last = startW;
      const onMove = (ev: PointerEvent) => {
        const next = startW - (ev.clientX - startX);
        last = next;
        setPanelWidth(next);
      };
      const onUp = (ev: PointerEvent) => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        handle.removeEventListener("pointercancel", onUp);
        void savePanelWidth(last);
      };
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
      handle.addEventListener("pointercancel", onUp);
    },
    [setPanelWidth, savePanelWidth],
  );

  const ensureSession = async () => {
    if (activeSessionId) return activeSessionId;
    const s = await createSession();
    return s.id;
  };

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const sid = await ensureSession();
      setInput("");
      await sendUserMessage(sid, text);
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(
      (m) =>
        m.content.toLowerCase().includes(q) ||
        (m.toolCalls ?? []).some((c) => c.name.toLowerCase().includes(q)),
    );
  }, [filter, messages]);

  return (
    <aside className="sa-panel sa-panel-rail" aria-label="Super Agent">
      <div
        className="sa-resize"
        onPointerDown={onResizePointerDown}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize Super Agent"
      />

      <header className="sa-header">
        <div className="sa-header-titles">
          {editingTitle && session ? (
            <input
              autoFocus
              defaultValue={session.name}
              className="sa-title-input"
              aria-label="Session name"
              onBlur={(e) => {
                if (e.target.value.trim()) void renameSession(session.id, e.target.value);
                setEditingTitle(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (e.currentTarget.value.trim())
                    void renameSession(session.id, e.currentTarget.value);
                  setEditingTitle(false);
                }
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
          ) : (
            <h2 className="sa-title-wrap">
              <button
                type="button"
                className="sa-title"
                onDoubleClick={() => session && setEditingTitle(true)}
                title="Double-click to rename"
              >
                {session?.name ?? "Super Agent"}
              </button>
            </h2>
          )}
          <select
            aria-label="Session"
            className="sa-session-switch"
            value={activeSessionId ?? ""}
            onChange={(e) => setActiveSession(e.target.value || null)}
          >
            {!activeSessionId && <option value="">— pick a session —</option>}
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="sa-header-actions">
          <button
            type="button"
            className={"btn btn-ghost sa-pause-toggle" + (pauseToolCalls ? " active" : "")}
            onClick={() => setPauseToolCalls(!pauseToolCalls)}
            title={
              pauseToolCalls
                ? "Tool calls paused — Run/Skip each one inline"
                : "Auto-running tool calls — click to require approval"
            }
            aria-pressed={pauseToolCalls}
            aria-label={pauseToolCalls ? "Tool calls paused" : "Tool calls auto-running"}
          >
            <span className="sa-pause-toggle-dot" aria-hidden="true" />
            <span>{pauseToolCalls ? "Paused" : "Auto"}</span>
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => createSession()}
            title="New session"
            aria-label="New session"
          >
            <Icon name="plus" size={12} />
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setPanelOpen(false)}
            title="Hide panel"
            aria-label="Hide panel"
          >
            <Icon name="chevron-right" size={12} />
          </button>
        </div>
      </header>

      <div className="sa-search">
        <input
          aria-label="Filter messages"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter messages or tool calls…"
        />
        {filter && (
          <button
            type="button"
            className="sa-search-clear"
            onClick={() => setFilter("")}
            aria-label="Clear filter"
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      <div className="sa-list-wrap">
        <div ref={listRef} className="sa-list" onScroll={onScroll}>
          {!session && (
            <div className="sa-empty">
              <div className="sa-empty-title">Start a conversation</div>
              <div className="sa-empty-sub">
                Click <kbd>+</kbd> in the header to create a new session, then ask the agent
                to inspect or change the workspace.
              </div>
            </div>
          )}
          {session && filtered.length === 0 && (
            <div className="sa-empty">
              <div className="sa-empty-sub">
                {filter ? "No messages match the filter." : "No messages yet."}
              </div>
            </div>
          )}
          {filtered.map((m) => (
            <MessageBubble key={m.id} message={m} sessionId={m.sessionId} />
          ))}
        </div>
        {!atBottom && (
          <button
            type="button"
            className="sa-jump"
            onClick={jumpToBottom}
            aria-label={unread > 0 ? `Jump to latest, ${unread} new` : "Jump to latest"}
          >
            ↓ {unread > 0 ? `${unread} new` : "Latest"}
          </button>
        )}
      </div>

      <form
        className="sa-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textareaRef}
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask Super Agent…  (⌘⏎ to send)"
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy}
        />
        <div className="sa-input-actions">
          <span className="sa-input-hint">
            {settings.streaming ? "streaming" : "one-shot"} · {settings.model || "(no model)"}
          </span>
          <button
            type="button"
            className={"btn btn-ghost sa-mic" + (sttPhase === "listening" ? " recording" : "")}
            onPointerDown={(e) => {
              if (sttPhase !== "idle" && sttPhase !== "error") return;
              // Focus the textarea so STT's snapshotActiveTarget picks it up
              // as a writable dom-input. Mirror the focus + startListening +
              // setPointerCapture pattern from the keyboard hotkey hold.
              textareaRef.current?.focus();
              e.currentTarget.setPointerCapture(e.pointerId);
              void useSttStore.getState().startListening();
            }}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              void useSttStore.getState().stopAndTranscribe();
            }}
            onPointerCancel={() => useSttStore.getState().cancel()}
            onPointerLeave={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) return;
            }}
            // Keyboard hold (Space/Enter) mirrors pointer hold so users who
            // can't reliably hold a pointer button still have access. The
            // browser would otherwise fire a click on Space/Enter release,
            // which would do nothing useful here — preventDefault swallows
            // the synthetic click.
            onKeyDown={(e) => {
              if (e.key !== " " && e.key !== "Enter") return;
              if (e.repeat) return;
              if (sttPhase !== "idle" && sttPhase !== "error") return;
              e.preventDefault();
              textareaRef.current?.focus();
              void useSttStore.getState().startListening();
            }}
            onKeyUp={(e) => {
              if (e.key !== " " && e.key !== "Enter") return;
              e.preventDefault();
              void useSttStore.getState().stopAndTranscribe();
            }}
            title="Hold to dictate (Space or pointer)"
            aria-label="Hold to dictate"
            aria-pressed={sttPhase === "listening"}
          >
            <Icon name="mic" size={12} aria-hidden="true" />
          </button>
          {activeStreamId ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => abortActive()}
              title="Stop generation"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy || !input.trim()}
            >
              {busy ? "…" : "Send"}
            </button>
          )}
        </div>
      </form>
    </aside>
  );
}
