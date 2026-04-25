import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { SearchAddon } from "@xterm/addon-search";
import { Channel } from "@tauri-apps/api/core";
import { ptySpawn, ptyWrite, ptyResize, ptyKill } from "../../lib/tauri";
import { useThemeStore } from "../../stores/themeStore";
import type { Pane } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { applyEvent, parseOsc133Payload, type CommandBlock } from "./osc133";
import { CommandBlocks } from "./CommandBlocks";
import { registerShortcut } from "../../lib/shortcuts";
import { Icon } from "../ui/Icon";

type Props = { pane: Pane; tabId: string };

export function Terminal({ pane, tabId }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const [blocks, setBlocks] = useState<CommandBlock[]>([]);
  const blocksRef = useRef<CommandBlock[]>([]);
  const [overlay, setOverlay] = useState({ rowHeight: 16, scrollTop: 0, height: 0 });
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const theme = useThemeStore((s) => s.current);
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);

  // Mount xterm
  useEffect(() => {
    if (!containerRef.current) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const term = new XTerm({
      fontFamily: 'ui-monospace, SFMono-Regular, "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: !reduceMotion,
      allowProposedApi: true,
      scrollback: 5000,
      theme: theme.terminal,
    });

    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(new ClipboardAddon());
    term.open(containerRef.current);
    // WebGL addon must load after open() — earlier loads crash RenderService on first paint.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      // WebGL unavailable — canvas fallback is automatic.
    }
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    // OSC 133 handler.
    term.parser.registerOscHandler(133, (raw: string) => {
      const evt = parseOsc133Payload(raw);
      if (!evt) return false;
      const buf = term.buffer.active;
      const absRow = buf.baseY + buf.cursorY;
      blocksRef.current = applyEvent(blocksRef.current, evt, absRow);
      setBlocks(blocksRef.current);
      return true;
    });

    // Track scroll + size for overlay positioning.
    const updateGeom = () => {
      const el = containerRef.current?.querySelector(".xterm-viewport") as HTMLElement | null;
      const rowH = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height: number } } } } } })._core?._renderService?.dimensions?.css?.cell?.height ?? 16;
      setOverlay({
        rowHeight: rowH,
        scrollTop: el?.scrollTop ?? 0,
        height: containerRef.current?.clientHeight ?? 0,
      });
    };
    term.onScroll(updateGeom);
    term.onRender(updateGeom);
    updateGeom();

    // Spawn PTY
    const channel = new Channel<Uint8Array>();
    channel.onmessage = (data) => {
      // data may be transferred as number[] from JSON; coerce.
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data as unknown as number[]);
      term.write(bytes);
    };

    const cols = term.cols;
    const rows = term.rows;
    let disposed = false;
    const spawnEnv = (pane.payload?.spawnEnv as Record<string, string> | undefined) ?? {};
    const spawnCwd = pane.payload?.spawnCwd as string | undefined;
    void ptySpawn({ cols, rows, env: spawnEnv, cwd: spawnCwd }, channel)
      .then((sid) => {
        if (disposed) {
          ptyKill(sid).catch(() => {});
          return;
        }
        sessionIdRef.current = sid;
        setPanePayload(tabId, pane.id, { sessionId: sid });
      })
      .catch((e) => {
        term.writeln(`\x1b[31m[teamship] failed to spawn pty: ${e}\x1b[0m`);
      });

    // Forward keystrokes
    const dataDisp = term.onData((data) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const bytes = new TextEncoder().encode(data);
      void ptyWrite(sid, bytes).catch(() => {});
    });

    // Forward resize on container resize
    const ro = new ResizeObserver(() => {
      try {
        fit.fit();
        const sid = sessionIdRef.current;
        if (sid) void ptyResize(sid, term.cols, term.rows).catch(() => {});
        updateGeom();
      } catch {/* noop */}
    });
    ro.observe(containerRef.current);

    // Drag-and-drop file path → write path bytes to PTY.
    const dropHandler = (ev: DragEvent) => {
      ev.preventDefault();
      const path = ev.dataTransfer?.getData("text/plain");
      if (!path) return;
      const sid = sessionIdRef.current;
      if (sid) void ptyWrite(sid, new TextEncoder().encode(path));
    };
    const dragOverHandler = (ev: DragEvent) => ev.preventDefault();
    const node = containerRef.current;
    node.addEventListener("drop", dropHandler);
    node.addEventListener("dragover", dragOverHandler);

    return () => {
      disposed = true;
      dataDisp.dispose();
      ro.disconnect();
      node.removeEventListener("drop", dropHandler);
      node.removeEventListener("dragover", dragOverHandler);
      const sid = sessionIdRef.current;
      if (sid) ptyKill(sid).catch(() => {});
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to theme changes
  useEffect(() => {
    const t = termRef.current;
    if (!t) return;
    t.options.theme = theme.terminal;
  }, [theme]);

  // Cmd+F opens in-terminal search (only when this pane is focused).
  useEffect(() => {
    const u = registerShortcut("search", () => {
      // Best-effort: if this pane's container has focus, open the search bar.
      const node = containerRef.current;
      if (!node) return;
      const active = document.activeElement;
      if (node.contains(active) || node === active) {
        setSearchOpen(true);
      }
    });
    return u;
  }, []);

  const runSearch = (q: string, dir: "next" | "prev") => {
    const s = searchRef.current;
    if (!s) return;
    if (dir === "next") s.findNext(q, { caseSensitive: false, wholeWord: false });
    else s.findPrevious(q, { caseSensitive: false, wholeWord: false });
  };

  // Auto-fire pending command after spawn (for agent-launched panes).
  // Depends on sessionId too: if pendingCommand is set before spawn, we re-evaluate
  // once the session arrives and fire then.
  const pendingCommand = pane.payload?.pendingCommand as string | undefined;
  const sessionId = pane.payload?.sessionId as string | undefined;
  useEffect(() => {
    if (!pendingCommand || !sessionId) return;
    const id = window.setTimeout(() => {
      void ptyWrite(sessionId, new TextEncoder().encode(pendingCommand + "\n"));
      setPanePayload(tabId, pane.id, { pendingCommand: undefined });
    }, 600);
    return () => clearTimeout(id);
  }, [pendingCommand, sessionId, pane.id, tabId, setPanePayload]);

  const toggleBlock = (id: string) => {
    blocksRef.current = blocksRef.current.map((b) =>
      b.id === id ? { ...b, collapsed: !b.collapsed } : b,
    );
    setBlocks(blocksRef.current);
  };

  return (
    <div className="terminal-wrap" ref={containerRef} tabIndex={0}>
      <CommandBlocks
        blocks={blocks}
        rowHeight={overlay.rowHeight}
        scrollTop={overlay.scrollTop}
        containerHeight={overlay.height}
        onToggle={toggleBlock}
      />
      {searchOpen && (
        <div className="terminal-search">
          <span className="terminal-search-prefix" aria-hidden="true">
            <Icon name="search" size={14} />
          </span>
          <input
            autoFocus
            placeholder="Search…"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              runSearch(e.target.value, "next");
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") setSearchOpen(false);
              if (e.key === "Enter") runSearch(searchQuery, e.shiftKey ? "prev" : "next");
            }}
          />
          <button
            className="icon-btn"
            onClick={() => runSearch(searchQuery, "prev")}
            aria-label="Previous match"
          >
            <Icon name="chevron-up" size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={() => runSearch(searchQuery, "next")}
            aria-label="Next match"
          >
            <Icon name="chevron-down" size={14} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setSearchOpen(false)}
            aria-label="Close search"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
