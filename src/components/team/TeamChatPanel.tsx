import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { useTeamStore } from "../../stores/teamStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { parseMessages, type TeamMessage } from "../../lib/teamMessages";
import {
  runSuperBrainTeamAsk,
  runSuperBrainTeamBroadcast,
} from "../../lib/superBrain";
import {
  teamWatchStart,
  teamWatchStop,
  type TeamMessagesEvent,
} from "../../lib/tauri";
import { ROLE_ACCENTS, ROLE_LABELS } from "../../lib/teamRoles";
import { Icon } from "../ui/Icon";

export function TeamChatPanel({ tabId }: { tabId: string }) {
  const team = useTeamStore((s) => s.teams.find((t) => t.tabId === tabId));
  const teamAgents = useTeamStore((s) => (team ? s.agents[team.id] ?? [] : []));
  const tab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === tabId));
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<string>("@all");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputId = useId();

  const refresh = useCallback(async () => {
    if (!team) return;
    try {
      const content = await readTextFile(`${team.teamDir}/MESSAGES.md`);
      setMessages(parseMessages(content));
    } catch {
      setMessages([]);
    }
  }, [team]);

  useEffect(() => {
    if (!team) return;
    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    const run = async () => {
      try {
        await teamWatchStart(team.id, team.teamDir);
      } catch (err) {
        console.warn("teamWatchStart failed", err);
      }
      if (cancelled) return;
      unlisten = await listen<TeamMessagesEvent>(`team:messages:${team.id}`, () => {
        void refresh();
      });
      void refresh();
    };
    void run();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
      void teamWatchStop(team.id).catch(() => {});
    };
  }, [team, refresh]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const targetOptions = useMemo(() => {
    return [
      { value: "@all", label: "All agents" },
      ...teamAgents.map((a) => ({
        value: `pane:${a.paneId ?? ""}|label:${a.label}`,
        label: `${a.label} (${ROLE_LABELS[a.role] ?? a.role})`,
      })),
    ];
  }, [teamAgents]);

  if (!team || !tab) return null;
  if (collapsed) {
    return (
      <button
        className="team-chat-tab"
        onClick={() => setCollapsed(false)}
        aria-label="Open team chat"
        title="Open team chat"
      >
        <Icon name="sparkles" size={14} />
      </button>
    );
  }

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setInfo(null);
    try {
      if (target === "@all") {
        const r = await runSuperBrainTeamBroadcast(tabId, text);
        setInfo(`Wrote draft to ${r.written} pane(s) — press Enter in each to send.`);
      } else {
        const paneIdMatch = target.match(/^pane:([^|]*)\|label:/);
        const paneId = paneIdMatch?.[1] ?? "";
        if (!paneId) {
          setInfo("That agent has no live pane yet — relaunch the team or wait for it to spawn.");
          return;
        }
        const ok = await runSuperBrainTeamAsk(paneId, text);
        setInfo(
          ok
            ? "Wrote draft — press Enter in that pane to send."
            : "No completed command block in that pane yet — wait for the prompt to settle.",
        );
      }
      setInput("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="team-chat" aria-label="Team chat">
      <header className="team-chat-header">
        <div className="team-chat-title">{team.name}</div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => setCollapsed(true)}
          aria-label="Collapse team chat"
          title="Collapse"
        >
          <Icon name="chevron-right" size={14} />
        </button>
      </header>

      <div className="team-chat-roster">
        {teamAgents.map((a) => (
          <span
            key={a.id}
            className="team-chat-pill"
            style={{ borderColor: ROLE_ACCENTS[a.role] }}
            title={ROLE_LABELS[a.role]}
          >
            {a.label}
          </span>
        ))}
      </div>

      <div ref={listRef} className="team-chat-list">
        {messages.length === 0 && (
          <div className="team-chat-empty">No messages yet.</div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="team-chat-message">
            <div className="team-chat-meta">
              <span className="team-chat-from">{m.from || "?"}</span>
              <span className="team-chat-arrow">→</span>
              <span className="team-chat-to">{m.to || "?"}</span>
              <span className={`team-chat-type team-chat-type-${m.type}`}>{m.type}</span>
              <span className="team-chat-ts">{m.ts}</span>
            </div>
            <div className="team-chat-body">{m.body}</div>
          </div>
        ))}
      </div>

      <form
        className="team-chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <select
          aria-label="Target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        >
          {targetOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <textarea
          id={inputId}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Write a directive… (writes draft into pane; user presses Enter to send)"
          rows={2}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !input.trim()}>
          {busy ? "…" : "Push draft"}
        </button>
      </form>
      {info && <div className="team-chat-info">{info}</div>}
    </aside>
  );
}
