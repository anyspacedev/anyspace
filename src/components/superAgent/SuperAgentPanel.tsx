import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { useSuperAgentSettingsStore } from "../../stores/superAgentSettingsStore";
import {
  COUNTDOWN_MS,
  MAX_RECORDING_MS,
  useSttStore,
} from "../../stores/sttStore";
import { abortActive, sendUserMessage } from "../../lib/superAgent/runner";
import { Icon } from "../ui/Icon";
import { Waveform } from "../stt/Waveform";
import { MessageBubble } from "./MessageBubble";
import { registerSuperAgentInput } from "./inputRegistry";
import { suggestSuperAgentPrompt } from "../../lib/aiSuggest/superAgentPrompt";
import { AiSuggestNotConfiguredError } from "../../lib/aiSuggest/runner";
import { useWorkspaceStore } from "../../stores/workspaceStore";

// Render a KeyboardEvent.code as a human-readable token. Mirrors SttBubble's
// helper but kept local so the SA panel doesn't import from a sibling component.
function displayHotkey(code: string): string {
  switch (code) {
    case "ControlRight": return "Right Ctrl";
    case "ControlLeft": return "Left Ctrl";
    case "AltRight": return "Right Alt";
    case "AltLeft": return "Left Alt";
    case "MetaRight": return "Right ⌘";
    case "MetaLeft": return "Left ⌘";
    case "ShiftRight": return "Right Shift";
    case "ShiftLeft": return "Left Shift";
    default: return code;
  }
}

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
  const sttMessage = useSttStore((s) => s.message);
  const sttAnalyser = useSttStore((s) => s.analyser);
  const sttRemainingMs = useSttStore((s) => s.remainingMs);
  const sttHotkey = useSttStore((s) => s.settings.hotkey);
  const sttApiKey = useSttStore((s) => s.settings.apiKey);

  const [input, setInput] = useState("");
  const [filter, setFilter] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [unread, setUnread] = useState(0);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestNeedsConfig, setSuggestNeedsConfig] = useState(false);
  const setView = useWorkspaceStore((s) => s.setView);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);
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

  // Auto-focus filter input when the search row opens; collapse on Escape.
  useEffect(() => {
    if (filterOpen) filterInputRef.current?.focus();
  }, [filterOpen]);

  // Esc cancels an in-flight recording from anywhere in the panel.
  useEffect(() => {
    if (sttPhase !== "listening") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        useSttStore.getState().cancel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sttPhase]);

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

  const runSuggest = async () => {
    console.log("[suggestWithAi:super-agent] click", { busy, suggesting });
    if (suggesting || busy) return;
    setSuggestError(null);
    setSuggestNeedsConfig(false);
    setSuggesting(true);
    try {
      const out = await suggestSuperAgentPrompt();
      setInput(out.prompt);
      // Focus the textarea so the user can edit / press Enter immediately.
      requestAnimationFrame(() => textareaRef.current?.focus());
    } catch (err) {
      console.error("[suggestWithAi:super-agent] caught", err);
      if (err instanceof AiSuggestNotConfiguredError) {
        setSuggestNeedsConfig(true);
        setSuggestError(err.message);
      } else {
        setSuggestError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSuggesting(false);
    }
  };

  // Tap-to-toggle dictation. Hold-to-talk is owned by the global hotkey
  // (sttStore + Rust monitor), which routes its transcription to this
  // textarea via inputRegistry. The mic button is intentionally a single
  // toggle so users don't have to discover the press-and-hold gesture.
  const toggleDictation = () => {
    const stt = useSttStore.getState();
    if (stt.phase === "listening") {
      void stt.stopAndTranscribe();
      return;
    }
    if (stt.phase !== "idle" && stt.phase !== "error") return;
    // Focus the textarea so snapshotActiveTarget picks it up as a writable
    // dom-input — same reason the previous press-hold flow focused first.
    textareaRef.current?.focus();
    void stt.startListening();
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

  // Composer state derives entirely from sttPhase plus busy/streaming flags
  // so the JSX below stays declarative. Keep the guard order: error wins so
  // a failed transcription is acknowledged before any new affordance shows.
  const isListening = sttPhase === "listening";
  const isTranscribing = sttPhase === "transcribing";
  const isVoiceActive = isListening || isTranscribing;
  const sttHasError = sttPhase === "error";
  const sttHasSuccess = sttPhase === "success";

  // Countdown only renders in the last COUNTDOWN_MS, so the badge isn't
  // distracting at rest — same threshold the floating bubble uses.
  const showCountdown = isListening && sttRemainingMs <= COUNTDOWN_MS;
  const countdownSec = Math.max(0, Math.ceil(sttRemainingMs / 1000));
  // 0 → 1 progress through the recording window for the rim ring.
  const recordProgress = isListening
    ? Math.min(1, 1 - sttRemainingMs / MAX_RECORDING_MS)
    : 0;

  const composerStateClass = isListening
    ? " sa-composer-listening"
    : isTranscribing
      ? " sa-composer-transcribing"
      : sttHasError
        ? " sa-composer-error"
        : sttHasSuccess
          ? " sa-composer-success"
          : "";

  const placeholder = isListening
    ? "Listening… speak naturally"
    : isTranscribing
      ? "Transcribing your voice…"
      : "Ask Super Agent — type, or tap the mic to dictate.  ⌘⏎ to send";

  const hotkeyLabel = displayHotkey(sttHotkey);

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
          {sessions.length > 0 && (
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
          )}
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
            className={"btn btn-ghost sa-icon-btn" + (filterOpen ? " active" : "")}
            onClick={() => {
              if (filterOpen) {
                setFilter("");
                setFilterOpen(false);
              } else {
                setFilterOpen(true);
              }
            }}
            title={filterOpen ? "Hide search" : "Search messages"}
            aria-label={filterOpen ? "Hide search" : "Search messages"}
            aria-pressed={filterOpen}
          >
            <Icon name="search" size={12} />
          </button>
          <button
            type="button"
            className="btn btn-ghost sa-icon-btn"
            onClick={() => createSession()}
            title="New session"
            aria-label="New session"
          >
            <Icon name="plus" size={12} />
          </button>
          <button
            type="button"
            className="btn btn-ghost sa-icon-btn"
            onClick={() => setPanelOpen(false)}
            title="Hide panel"
            aria-label="Hide panel"
          >
            <Icon name="chevron-right" size={12} />
          </button>
        </div>
      </header>

      {filterOpen && (
        <div className="sa-search">
          <input
            ref={filterInputRef}
            aria-label="Filter messages"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter messages or tool calls…"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setFilter("");
                setFilterOpen(false);
              }
            }}
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
      )}

      <div className="sa-list-wrap">
        <div ref={listRef} className="sa-list" onScroll={onScroll}>
          {!session && (
            <div className="sa-empty">
              <div className="sa-empty-title">Start a conversation</div>
              <div className="sa-empty-sub">
                Tap the mic below to dictate, or hold <kbd>{hotkeyLabel}</kbd> from anywhere
                to push-to-talk into Super Agent.
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
        className={"sa-composer" + composerStateClass}
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        aria-busy={isVoiceActive || busy}
      >
        {/* Voice lane — overlays the textarea while the mic is active so
            the waveform is the focal element, not a sidekick badge. */}
        {isVoiceActive && (
          <div
            className="sa-voice-lane"
            role="status"
            aria-live="polite"
            aria-label={isListening ? "Recording" : "Transcribing"}
          >
            <span className="sa-voice-dot" aria-hidden="true" />
            <span className="sa-voice-label">
              {isListening ? "Listening" : "Transcribing"}
            </span>
            <Waveform analyser={isListening ? sttAnalyser : null} />
            {isTranscribing && <span className="sa-voice-shimmer" aria-hidden="true" />}
            {showCountdown && (
              <span className="sa-voice-countdown" aria-label={`${countdownSec} seconds remaining`}>
                {countdownSec}s
              </span>
            )}
            {isListening && (
              <button
                type="button"
                className="sa-voice-cancel"
                onClick={() => useSttStore.getState().cancel()}
                title="Cancel (Esc)"
                aria-label="Cancel recording"
              >
                <Icon name="x" size={12} />
              </button>
            )}
          </div>
        )}

        {sttHasError && sttMessage && (
          <div className="sa-voice-flash sa-voice-flash-error" role="alert">
            <Icon name="alert-circle" size={12} />
            <span>{sttMessage}</span>
            <button
              type="button"
              className="sa-voice-flash-dismiss"
              onClick={() => useSttStore.getState().dismiss()}
              aria-label="Dismiss"
            >
              <Icon name="x" size={10} />
            </button>
          </div>
        )}
        {sttHasSuccess && sttMessage && (
          <div className="sa-voice-flash sa-voice-flash-success" role="status">
            <Icon name="check" size={12} />
            <span>{sttMessage}</span>
          </div>
        )}

        <textarea
          ref={textareaRef}
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={placeholder}
          rows={3}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
          disabled={busy || isVoiceActive}
          aria-hidden={isVoiceActive}
        />

        <div className="sa-composer-bar">
          <div className="sa-composer-meta">
            {sttApiKey ? (
              <span className="sa-hotkey-hint">
                Hold <kbd>{hotkeyLabel}</kbd> to talk
              </span>
            ) : (
              <span className="sa-hotkey-hint sa-hotkey-hint-warn">
                Voice off — add an STT key in Settings
              </span>
            )}
            <span className="sa-composer-model" title={settings.model || "no model"}>
              {settings.streaming ? "stream" : "one-shot"} · {settings.model || "(no model)"}
            </span>
            {suggestError && (
              <span className="sa-hotkey-hint sa-hotkey-hint-warn">
                AI: {suggestError}
                {suggestNeedsConfig && (
                  <>
                    {" — "}
                    <button
                      type="button"
                      className="team-section-link"
                      onClick={() => {
                        setView("settings");
                        setPanelOpen(false);
                      }}
                    >
                      Open Settings → AI
                    </button>
                  </>
                )}
              </span>
            )}
          </div>

          <div className="sa-composer-actions">
            <button
              type="button"
              className={
                "sa-mic-btn" +
                (isListening ? " recording" : "") +
                (isTranscribing ? " transcribing" : "") +
                (!sttApiKey ? " disabled" : "")
              }
              onClick={() => {
                if (!sttApiKey) return;
                toggleDictation();
              }}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  if (!sttApiKey) return;
                  toggleDictation();
                }
              }}
              disabled={!sttApiKey && !isVoiceActive}
              aria-pressed={isListening}
              aria-label={
                isListening
                  ? "Stop recording"
                  : isTranscribing
                    ? "Transcribing"
                    : "Start dictation"
              }
              title={
                isListening
                  ? "Stop recording (Esc to cancel)"
                  : isTranscribing
                    ? "Transcribing…"
                    : `Tap to dictate · Hold ${hotkeyLabel} globally`
              }
            >
              {isListening && (
                <svg
                  className="sa-mic-rim"
                  viewBox="0 0 44 44"
                  aria-hidden="true"
                >
                  <circle
                    cx="22"
                    cy="22"
                    r="20"
                    fill="none"
                    strokeWidth="2"
                    pathLength={1}
                    strokeDasharray={1}
                    strokeDashoffset={1 - recordProgress}
                  />
                </svg>
              )}
              {isListening ? (
                <span className="sa-mic-stop" aria-hidden="true" />
              ) : isTranscribing ? (
                <span className="sa-mic-spin" aria-hidden="true" />
              ) : (
                <Icon name="mic" size={16} />
              )}
            </button>

            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={runSuggest}
              disabled={suggesting || busy}
              title="Draft a starter prompt from the active pane (last command, file, or URL)"
            >
              <Icon name="sparkles" size={14} />
              <span>{suggesting ? "Thinking…" : "Suggest"}</span>
            </button>

            {activeStreamId ? (
              <button
                type="button"
                className="btn btn-ghost sa-stop-btn"
                onClick={() => abortActive()}
                title="Stop generation"
              >
                Stop
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn-primary sa-send-btn"
                disabled={busy || !input.trim() || isVoiceActive}
                title="Send message (⌘⏎)"
              >
                {busy ? "…" : "Send"}
              </button>
            )}
          </div>
        </div>
      </form>
    </aside>
  );
}
