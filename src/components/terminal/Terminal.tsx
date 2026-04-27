import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { ClipboardAddon } from "@xterm/addon-clipboard";
import { SearchAddon } from "@xterm/addon-search";
import { hardenRenderService } from "./xtermPatches";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ptySpawn, ptyWrite, ptyResize, ptyKill, clipboardSaveBlob } from "../../lib/tauri";
import { useThemeStore } from "../../stores/themeStore";
import type { Pane } from "../../lib/types";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { applyEvent, parseOsc133Payload, type CommandBlock } from "./osc133";
import { extractCommand, extractOutput } from "./blockBuffer";
import { CommandBlocks } from "./CommandBlocks";
import type { BlockAction } from "./BlockActions";
import { AiExplainPopover } from "./AiExplainPopover";
import { registerShortcut } from "../../lib/shortcuts";
import { broadcastBytes } from "../../lib/paneBroadcast";
import { registerTerminal, unregisterTerminal } from "./terminalRegistry";
import { Icon } from "../ui/Icon";

type Props = { pane: Pane; tabId: string };

// Browsers cap active WebGL contexts (Chromium ~16, WebKit ~8) and evict the
// oldest when exceeded, spamming the console. Cap WebGL terminals well below
// that — extra panes use xterm's default DOM renderer, which is slower but has
// no per-pane GPU cost.
const MAX_WEBGL_TERMINALS = 6;
let activeWebglTerminals = 0;

function quoteShellPath(p: string): string {
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

function formatBlockMarkdown(block: CommandBlock, output: string): string {
  const cmd = block.command ?? "(unknown command)";
  const exit = block.exitCode;
  const exitLine = exit !== undefined ? `\n\n_exit ${exit}_` : "";
  return "```bash\n$ " + cmd + "\n" + output + "\n```" + exitLine;
}

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
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const focusedBlockIdRef = useRef<string | null>(null);
  const [explain, setExplain] = useState<{ block: CommandBlock; output: string } | null>(null);
  const theme = useThemeStore((s) => s.current);
  const setPanePayload = useWorkspaceStore((s) => s.setPanePayload);
  const closePane = useWorkspaceStore((s) => s.closePane);

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
    // Harden the RenderService.dimensions getter against post-dispose access
    // from xterm's own internal timers (Viewport schedules a syncScrollArea
    // via setTimeout in its constructor that can fire after term.dispose()).
    hardenRenderService(term);
    // WebGL addon must load after open() — earlier loads crash RenderService on first paint.
    // Cap concurrent WebGL contexts; the rest use xterm's default DOM renderer.
    let webglClaimed = false;
    if (activeWebglTerminals < MAX_WEBGL_TERMINALS) {
      try {
        const webgl = new WebglAddon();
        activeWebglTerminals += 1;
        webglClaimed = true;
        webgl.onContextLoss(() => {
          if (webglClaimed) {
            webglClaimed = false;
            activeWebglTerminals = Math.max(0, activeWebglTerminals - 1);
          }
          webgl.dispose();
        });
        term.loadAddon(webgl);
      } catch {
        if (webglClaimed) {
          webglClaimed = false;
          activeWebglTerminals = Math.max(0, activeWebglTerminals - 1);
        }
        // WebGL unavailable — DOM renderer fallback is automatic.
      }
    }

    termRef.current = term;
    fitRef.current = fit;
    searchRef.current = search;

    // Quote, optionally wrap with bracketed-paste markers, and stream the
    // result to the PTY. Shared between the global drop dispatcher and the
    // local paste interceptor so both paths produce identical bytes —
    // Claude Code only converts paths to [Image #N] placeholders inside
    // bracketed-paste chunks, so the gate must match in both flows.
    const dispatchPaths = (paths: string[]) => {
      const sid = sessionIdRef.current;
      if (!sid || paths.length === 0) return;
      let text = paths.map(quoteShellPath).join(" ");
      if (term.modes.bracketedPasteMode) {
        text = `\x1b[200~${text}\x1b[201~`;
      }
      void ptyWrite(sid, new TextEncoder().encode(text)).catch(() => {});
    };

    // Expose to non-React callers (Super Brain, global drag-drop dispatcher)
    // for output capture, PTY session lookup, and OS file drops. Closures keep
    // readers pointed at the live refs without forcing this component to
    // re-render.
    registerTerminal(pane.id, {
      term,
      getBlocks: () => blocksRef.current,
      getSessionId: () => sessionIdRef.current,
      handleDrop: dispatchPaths,
    });

    // Capture-phase paste interceptor. xterm's ClipboardAddon handles plain
    // text pastes (and wraps them in bracketed-paste markers automatically),
    // but the clipboard can also carry file blobs (image bytes from a
    // screenshot tool) or text/uri-list (file references from a file
    // manager) — neither of which would surface as text. We snapshot the
    // clipboard synchronously, fall through silently if it's text-only, and
    // otherwise resolve to absolute paths and route through the same
    // dispatchPaths used by drops.
    const onPaste = (e: ClipboardEvent) => {
      const data = e.clipboardData;
      if (!data) return;
      const blobs: File[] = [];
      for (const it of data.items) {
        if (it.kind === "file") {
          const f = it.getAsFile();
          if (f) blobs.push(f);
        }
      }
      const uriList = data.getData("text/uri-list");
      const hasUris = uriList.split(/\r?\n/).some((l) => l.startsWith("file://"));
      if (blobs.length === 0 && !hasUris) return;
      e.preventDefault();
      e.stopPropagation();
      void (async () => {
        const paths: string[] = [];
        for (const f of blobs) {
          try {
            const buf = new Uint8Array(await f.arrayBuffer());
            const ext = (f.type.split("/")[1] ?? "bin").split("+")[0] || "bin";
            paths.push(await clipboardSaveBlob(buf, ext));
          } catch {/* skip this blob */}
        }
        if (hasUris) {
          for (const line of uriList.split(/\r?\n/)) {
            if (!line.startsWith("file://")) continue;
            try {
              paths.push(decodeURIComponent(line.replace(/^file:\/\//, "")));
            } catch {/* skip malformed URI */}
          }
        }
        if (paths.length > 0) dispatchPaths(paths);
      })();
    };
    const pasteHost = containerRef.current;
    pasteHost.addEventListener("paste", onPaste, true);

    // WebKitGTK occasionally drops the mouseup that follows a click inside
    // xterm. When that happens, xterm's SelectionService keeps its
    // _dragScrollIntervalTimer running and every subsequent mousemove —
    // even with no button pressed — keeps extending the selection (the
    // "click → move → wheel scrolls but selects text" bug). Recover by
    // synthesising a mouseup on the document the moment we see a mousemove
    // with buttons === 0 while xterm still thinks the primary button is
    // held. The synthetic event drives xterm's own _handleMouseUp, which
    // tears down its document listeners and clears the interval.
    const tag = `[term-debug ${pane.id.slice(0, 6)}]`;
    type SelDebug = {
      _core?: {
        _selectionService?: {
          _dragScrollIntervalTimer?: number;
          _model?: { selectionStart?: unknown; selectionEnd?: unknown };
        };
      };
    };
    const selState = () => {
      const s = (term as unknown as SelDebug)._core?._selectionService;
      return {
        timer: s?._dragScrollIntervalTimer,
        start: s?._model?.selectionStart,
        end: s?._model?.selectionEnd,
      };
    };
    const describe = (e: MouseEvent | WheelEvent) => {
      const t = e.target as Element | null;
      return {
        tag: t?.tagName,
        cls: t instanceof HTMLElement ? t.className : undefined,
        x: e.clientX,
        y: e.clientY,
        button: (e as MouseEvent).button,
        buttons: e.buttons,
      };
    };
    const onDebugDown = (e: MouseEvent) => {
      console.log(`${tag} mousedown buttons=${e.buttons}`, describe(e), selState());
    };
    const onDebugUp = (e: MouseEvent) => {
      console.log(`${tag} mouseup buttons=${e.buttons}`, describe(e), selState());
    };
    let lastMoveLog = 0;
    const onDocMouseMove = (e: MouseEvent) => {
      const state = selState();
      // Recovery: stuck selection + no button pressed → fake a mouseup so
      // xterm releases its document listeners. Only the pane that owns the
      // stuck timer should dispatch (otherwise every mounted Terminal would
      // race to fire one).
      if (state.timer !== undefined && e.buttons === 0) {
        console.warn(`${tag} stuck selection — synthesising mouseup`, describe(e), state);
        document.dispatchEvent(
          new MouseEvent("mouseup", {
            bubbles: true,
            cancelable: true,
            view: window,
            button: 0,
            buttons: 0,
            clientX: e.clientX,
            clientY: e.clientY,
            screenX: e.screenX,
            screenY: e.screenY,
          }),
        );
        return;
      }
      const now = performance.now();
      if (now - lastMoveLog < 80) return;
      lastMoveLog = now;
      console.log(`${tag} mousemove buttons=${e.buttons}`, describe(e), state);
    };
    const onDebugWheel = (e: WheelEvent) => {
      console.log(`${tag} wheel buttons=${e.buttons}`, { ...describe(e), dy: e.deltaY }, selState());
    };
    pasteHost.addEventListener("mousedown", onDebugDown, true);
    pasteHost.addEventListener("wheel", onDebugWheel, true);
    document.addEventListener("mouseup", onDebugUp, true);
    document.addEventListener("mousemove", onDocMouseMove, true);

    // Defer the first fit: calling fit.fit() synchronously after open()
    // races the renderer init and crashes on `_renderer.value.dimensions`.
    const safeFit = () => {
      try {
        fit.fit();
      } catch {
        /* renderer not ready yet */
      }
    };
    const initialFitRaf = requestAnimationFrame(safeFit);

    // OSC 133 handler.
    term.parser.registerOscHandler(133, (raw: string) => {
      const evt = parseOsc133Payload(raw);
      if (!evt) return false;
      const buf = term.buffer.active;
      const absRow = buf.baseY + buf.cursorY;
      // At the C boundary the prompt+command rows are guaranteed live —
      // capture the typed command before any further output can scroll
      // them out of the buffer.
      let captured: string | undefined;
      if (evt.kind === "outputStart") {
        const last = blocksRef.current[blocksRef.current.length - 1];
        if (last) {
          captured = extractCommand(term, last.startRow, absRow) ?? undefined;
        }
      }
      blocksRef.current = applyEvent(blocksRef.current, evt, absRow, captured);
      setBlocks(blocksRef.current);
      return true;
    });

    // Track scroll + size for overlay positioning.
    const updateGeom = () => {
      try {
        const el = containerRef.current?.querySelector(".xterm-viewport") as HTMLElement | null;
        const rowH = (term as unknown as { _core?: { _renderService?: { dimensions?: { css?: { cell?: { height: number } } } } } })._core?._renderService?.dimensions?.css?.cell?.height ?? 16;
        setOverlay({
          rowHeight: rowH,
          scrollTop: el?.scrollTop ?? 0,
          height: containerRef.current?.clientHeight ?? 0,
        });
      } catch {
        /* renderer not ready yet */
      }
    };
    term.onScroll(updateGeom);
    term.onRender(updateGeom);

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
    let exitUnlisten: (() => void) | null = null;
    const spawnEnv = (pane.payload?.spawnEnv as Record<string, string> | undefined) ?? {};
    // Fall back to the workspace's project folder so a freshly-opened terminal
    // lands in the same directory as the rest of the workspace by default.
    const tabProjectPath = useWorkspaceStore.getState().tabs.find((t) => t.id === tabId)?.projectPath;
    const spawnCwd = (pane.payload?.spawnCwd as string | undefined) ?? tabProjectPath;
    void ptySpawn({ cols, rows, env: spawnEnv, cwd: spawnCwd }, channel)
      .then((sid) => {
        if (disposed) {
          ptyKill(sid).catch(() => {});
          return;
        }
        sessionIdRef.current = sid;
        setPanePayload(tabId, pane.id, { sessionId: sid });
        // Shell exited (typed `exit`, Ctrl+D, kill, …) → close the pane
        // immediately rather than leave a dead terminal sitting around.
        void listen(`pty:exit:${sid}`, () => {
          if (disposed) return;
          closePane(tabId, pane.id);
        }).then((u) => {
          if (disposed) u();
          else exitUnlisten = u;
        });
      })
      .catch((e) => {
        term.writeln(`\x1b[31m[teamship] failed to spawn pty: ${e}\x1b[0m`);
      });

    // Forward keystrokes. When this pane is part of a multi-select group,
    // also fan out to every other selected pane — mirrors every byte (incl.
    // arrows, Ctrl+C, paste). The broadcast pill in the header is mandatory.
    const dataDisp = term.onData((data) => {
      const sid = sessionIdRef.current;
      if (!sid) return;
      const bytes = new TextEncoder().encode(data);
      void ptyWrite(sid, bytes).catch(() => {});
      broadcastBytes(pane.id, bytes);
    });

    // Forward resize on container resize. Defer to rAF so we don't race
    // the renderer when the observer fires synchronously on observe().
    let resizeRaf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(resizeRaf);
      resizeRaf = requestAnimationFrame(() => {
        try {
          fit.fit();
          const sid = sessionIdRef.current;
          if (sid) void ptyResize(sid, term.cols, term.rows).catch(() => {});
          updateGeom();
        } catch {/* noop */}
      });
    });
    ro.observe(containerRef.current);

    // OS drag-drop is handled by the global dispatcher in App.tsx, which
    // hit-tests via document.elementFromPoint and routes to this pane's
    // registered handleDrop. Per-pane subscriptions are unreliable in
    // multi-pane layouts on some platforms, so we centralise instead.

    return () => {
      disposed = true;
      cancelAnimationFrame(initialFitRaf);
      cancelAnimationFrame(resizeRaf);
      dataDisp.dispose();
      ro.disconnect();
      pasteHost.removeEventListener("paste", onPaste, true);
      pasteHost.removeEventListener("mousedown", onDebugDown, true);
      pasteHost.removeEventListener("wheel", onDebugWheel, true);
      document.removeEventListener("mouseup", onDebugUp, true);
      document.removeEventListener("mousemove", onDocMouseMove, true);
      exitUnlisten?.();
      unregisterTerminal(pane.id);
      const sid = sessionIdRef.current;
      if (sid) ptyKill(sid).catch(() => {});
      term.dispose();
      if (webglClaimed) {
        webglClaimed = false;
        activeWebglTerminals = Math.max(0, activeWebglTerminals - 1);
      }
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

  // Cmd+[ / Cmd+] jump between command blocks (focus-gated to this pane).
  useEffect(() => {
    const focusedHere = () => {
      const node = containerRef.current;
      if (!node) return false;
      const active = document.activeElement;
      return node.contains(active) || node === active;
    };
    const jump = (dir: "prev" | "next") => {
      if (!focusedHere()) return;
      const term = termRef.current;
      if (!term) return;
      const sorted = [...blocksRef.current].sort((a, b) => a.startRow - b.startRow);
      if (sorted.length === 0) return;
      const currentIdx = focusedBlockIdRef.current
        ? sorted.findIndex((b) => b.id === focusedBlockIdRef.current)
        : -1;
      let nextIdx: number;
      if (currentIdx < 0) {
        nextIdx = dir === "prev" ? sorted.length - 1 : 0;
      } else {
        nextIdx = dir === "prev"
          ? Math.max(0, currentIdx - 1)
          : Math.min(sorted.length - 1, currentIdx + 1);
      }
      const target = sorted[nextIdx];
      if (!target) return;
      try {
        // Put the block top a couple of rows below the viewport top.
        term.scrollToLine(Math.max(0, target.startRow - 2));
      } catch {
        /* eviction or pre-paint — silently no-op */
      }
      focusedBlockIdRef.current = target.id;
      setFocusedBlockId(target.id);
    };
    const uPrev = registerShortcut("jumpBlockPrev", () => jump("prev"));
    const uNext = registerShortcut("jumpBlockNext", () => jump("next"));
    return () => { uPrev(); uNext(); };
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

  const handleAction = (action: BlockAction, blockId: string) => {
    const term = termRef.current;
    const block = blocksRef.current.find((b) => b.id === blockId);
    if (!block || !term) return;
    switch (action) {
      case "rerun": {
        const sid = sessionIdRef.current;
        if (!sid || !block.command) return;
        // Ctrl-U clears any half-typed input on the live prompt before we
        // submit, so re-running never appends to whatever the user was
        // mid-typing.
        const payload = "\x15" + block.command + "\n";
        void ptyWrite(sid, new TextEncoder().encode(payload)).catch(() => {});
        break;
      }
      case "copyCmd":
        void navigator.clipboard.writeText(block.command ?? "");
        break;
      case "copyOut": {
        const out = extractOutput(term, block) ?? "(scrolled out of buffer)";
        void navigator.clipboard.writeText(out);
        break;
      }
      case "copyMd": {
        const out = extractOutput(term, block) ?? "(scrolled out of buffer)";
        void navigator.clipboard.writeText(formatBlockMarkdown(block, out));
        break;
      }
      case "explain": {
        const out = extractOutput(term, block) ?? "(scrolled out of buffer)";
        setExplain({ block, output: out });
        break;
      }
    }
  };

  return (
    <div className="terminal-wrap" ref={containerRef} tabIndex={0}>
      <CommandBlocks
        blocks={blocks}
        rowHeight={overlay.rowHeight}
        scrollTop={overlay.scrollTop}
        containerHeight={overlay.height}
        onToggle={toggleBlock}
        onAction={handleAction}
        focusedBlockId={focusedBlockId}
      />
      {explain && (
        <AiExplainPopover
          key={explain.block.id}
          block={explain.block}
          output={explain.output}
          onClose={() => setExplain(null)}
        />
      )}
      {searchOpen && (
        <div className="terminal-search">
          <span className="terminal-search-prefix" aria-hidden="true">
            <Icon name="search" size={14} />
          </span>
          <input
            autoFocus
            aria-label="Search terminal"
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
