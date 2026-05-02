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
  teamCompactMessages,
  teamWatchStart,
  teamWatchStop,
  type TeamMessagesEvent,
} from "../../lib/tauri";
import { roleAccent, roleLabel } from "../../lib/teamRoles";
import { useTeamSettingsStore } from "../../stores/teamSettingsStore";
import { Icon } from "../ui/Icon";

const GROUP_WINDOW_MS = 5 * 60 * 1000;
const COMPACT_THRESHOLD = 500;
const COMPACT_KEEP = 250;
const COMPACT_DEBOUNCE_MS = 60_000;

function tsMillis(ts: string): number {
  const v = Date.parse(ts);
  return Number.isNaN(v) ? 0 : v;
}

function shortTime(ts: string): string {
  const v = tsMillis(ts);
  if (!v) return ts;
  return new Date(v).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function TeamChatPanel({ tabId }: { tabId: string }) {
  const team = useTeamStore((s) => s.teams.find((t) => t.tabId === tabId));
  const teamAgents = useTeamStore((s) => (team ? s.agents[team.id] ?? [] : []));
  const tab = useWorkspaceStore((s) => s.tabs.find((t) => t.id === tabId));
  const customRoles = useTeamSettingsStore((s) => s.settings.customRoles);
  const [messages, setMessages] = useState<TeamMessage[]>([]);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<string>("@all");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const lastCompactRef = useRef<number>(0);
  const inputId = useId();

  const refresh = useCallback(async () => {
    if (!team) return;
    try {
      const content = await readTextFile(`${team.teamDir}/MESSAGES.md`);
      const parsed = parseMessages(content);
      setMessages(parsed);
      // Auto-compact when MESSAGES.md crosses the threshold. Debounced so a
      // burst of refreshes doesn't trigger N rotations; the Rust side holds
      // the same flock as tmsg.sh so concurrent sends are safe.
      if (parsed.length > COMPACT_THRESHOLD) {
        const now = Date.now();
        if (now - lastCompactRef.current > COMPACT_DEBOUNCE_MS) {
          lastCompactRef.current = now;
          teamCompactMessages({
            teamDir: team.teamDir,
            maxEntries: COMPACT_THRESHOLD,
            keepRecent: COMPACT_KEEP,
          })
            .then((r) => {
              if (r.archived > 0) {
                console.log("[team.chat] compacted", r);
              }
            })
            .catch((e) => console.warn("[team.chat] compact failed", e));
        }
      }
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

  // Auto-scroll to bottom on new messages — but only when the user was
  // already at the bottom. If they scrolled up to read history, leave
  // their viewport alone and surface the jump-to-bottom button.
  useEffect(() => {
    if (!atBottom) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, atBottom]);

  const onScroll = () => {
    const el = listRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setAtBottom(distance < 24);
  };

  const jumpToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAtBottom(true);
  };

  // Group consecutive messages from the same sender to the same recipient
  // within GROUP_WINDOW_MS. Each group renders one meta header and stacks
  // bodies underneath.
  const groups = useMemo(() => {
    const filtered = filter.trim().toLowerCase()
      ? messages.filter((m) => {
          const q = filter.trim().toLowerCase();
          return (
            m.body.toLowerCase().includes(q) ||
            m.from.toLowerCase().includes(q) ||
            m.to.toLowerCase().includes(q)
          );
        })
      : messages;
    const out: TeamMessage[][] = [];
    for (const m of filtered) {
      const last = out[out.length - 1];
      const prev = last?.[last.length - 1];
      if (
        prev &&
        prev.from === m.from &&
        prev.to === m.to &&
        prev.type === m.type &&
        Math.abs(tsMillis(m.ts) - tsMillis(prev.ts)) < GROUP_WINDOW_MS
      ) {
        last.push(m);
      } else {
        out.push([m]);
      }
    }
    return out;
  }, [messages, filter]);

  const targetOptions = useMemo(() => {
    return [
      { value: "@all", label: "All agents" },
      ...teamAgents.map((a) => ({
        value: `pane:${a.paneId ?? ""}|label:${a.label}`,
        label: `${a.label} (${roleLabel(a.role, customRoles)})`,
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
            style={{ borderColor: roleAccent(a.role, customRoles) }}
            title={roleLabel(a.role, customRoles)}
          >
            {a.label}
          </span>
        ))}
      </div>

      <div className="team-chat-search">
        <input
          aria-label="Filter messages"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter… (matches sender / recipient / body)"
        />
        {filter && (
          <button
            type="button"
            className="team-chat-search-clear"
            onClick={() => setFilter("")}
            aria-label="Clear filter"
          >
            <Icon name="x" size={12} />
          </button>
        )}
      </div>

      <div ref={listRef} className="team-chat-list" onScroll={onScroll}>
        {groups.length === 0 && (
          <div className="team-chat-empty">
            {filter ? "No messages match the filter." : "No messages yet."}
          </div>
        )}
        {groups.map((group, gi) => {
          const head = group[0];
          const isOperator = head.to === "@operator" || head.from === "@operator";
          return (
            <div
              key={`${head.id}-${gi}`}
              className={"team-chat-group" + (isOperator ? " team-chat-group-operator" : "")}
            >
              <div className="team-chat-meta">
                <span className="team-chat-from">{head.from || "?"}</span>
                <span className="team-chat-arrow">→</span>
                <span className="team-chat-to">{head.to || "?"}</span>
                <span className={`team-chat-type team-chat-type-${head.type}`}>{head.type}</span>
                <span className="team-chat-ts">{shortTime(head.ts)}</span>
              </div>
              {group.map((m) => (
                <div key={m.id} className="team-chat-body">{m.body}</div>
              ))}
            </div>
          );
        })}
      </div>

      {!atBottom && (
        <button
          type="button"
          className="team-chat-jump"
          onClick={jumpToBottom}
          aria-label="Jump to latest"
        >
          ↓ Latest
        </button>
      )}

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
