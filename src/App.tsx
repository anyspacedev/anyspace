import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useThemeStore } from "./stores/themeStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useKanbanStore } from "./stores/kanbanStore";
import { useSttStore } from "./stores/sttStore";
import { useAiStore } from "./stores/aiStore";
import { useProxyStore } from "./stores/proxyStore";
import { attachGlobalShortcuts, registerShortcut } from "./lib/shortcuts";
import { runSuperBrain } from "./lib/superBrain";
import { dispatchDropToPane } from "./components/terminal/terminalRegistry";
import { TabBar } from "./components/workspace/TabBar";
import { Sidebar } from "./components/workspace/Sidebar";
import { WorkspaceView } from "./components/workspace/WorkspaceView";
import { KanbanBoard } from "./components/kanban/Board";
import { AgentManager } from "./components/agents/AgentManager";
import { Settings } from "./components/settings/Settings";
import { StatusBar } from "./components/workspace/StatusBar";
import { TemplatePicker } from "./components/workspace/TemplatePicker";
import { QuickOpen } from "./components/sidebar/QuickOpen";
import { SttBubble } from "./components/stt/SttBubble";

export default function App() {
  const loadTheme = useThemeStore((s) => s.load);
  const cycleTheme = useThemeStore((s) => s.cycle);
  const view = useWorkspaceStore((s) => s.selectedView);
  const newTab = useWorkspaceStore((s) => s.newTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const switchToTabIndex = useWorkspaceStore((s) => s.switchToTabIndex);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const hydrateWorkspace = useWorkspaceStore((s) => s.hydrate);
  const loadKanban = useKanbanStore((s) => s.load);
  const loadStt = useSttStore((s) => s.load);
  const loadAi = useAiStore((s) => s.load);
  const loadProxy = useProxyStore((s) => s.load);

  useEffect(() => {
    void loadTheme();
    void hydrateWorkspace();
    void loadKanban().catch((e) => console.warn("[kanban] load failed", e));
    void loadStt().catch((e) => console.warn("[stt] load failed", e));
    void loadAi().catch((e) => console.warn("[ai] load failed", e));
    void loadProxy().catch((e) => console.warn("[proxy] load failed", e));
  }, [loadTheme, hydrateWorkspace, loadKanban, loadStt, loadAi, loadProxy]);

  // Global OS drag-drop dispatcher. WebKitGTK's `drop` payload reports the
  // drag-entry position rather than the cursor at release, so the latest
  // `over` event is the only reliable cursor source. Hit-testing iterates
  // pane rects directly (elementFromPoint gets confused by .pane-drop-hint
  // and command-block overlays), and falls back to the user-focused pane
  // when nothing is under the cursor.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    let lastPos: { x: number; y: number } | null = null;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const dpr = window.devicePixelRatio || 1;
        if (event.payload.type === "enter" || event.payload.type === "over") {
          lastPos = {
            x: event.payload.position.x / dpr,
            y: event.payload.position.y / dpr,
          };
          return;
        }
        if (event.payload.type === "leave") {
          lastPos = null;
          return;
        }
        if (event.payload.type !== "drop") return;
        if (useWorkspaceStore.getState().selectedView !== "workspace") return;
        const x = lastPos?.x ?? event.payload.position.x / dpr;
        const y = lastPos?.y ?? event.payload.position.y / dpr;
        let paneId: string | null = null;
        for (const el of document.querySelectorAll<HTMLElement>("[data-pane-id]")) {
          const r = el.getBoundingClientRect();
          if (x >= r.left && x < r.right && y >= r.top && y < r.bottom) {
            paneId = el.dataset.paneId ?? null;
            break;
          }
        }
        const dispatched = paneId
          ? dispatchDropToPane(paneId, event.payload.paths)
          : false;
        if (!dispatched) {
          const ws = useWorkspaceStore.getState();
          const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
          const fallback = tab?.activePaneId;
          if (fallback && fallback !== paneId) {
            dispatchDropToPane(fallback, event.payload.paths);
          }
        }
        lastPos = null;
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlisten = fn;
      })
      .catch(() => {/* noop */});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const detach = attachGlobalShortcuts();
    const unregisters = [
      registerShortcut("newTab", () => newTab(1)),
      registerShortcut("closeTab", () => activeTabId && closeTab(activeTabId)),
      registerShortcut("switchTab1", () => switchToTabIndex(0)),
      registerShortcut("switchTab2", () => switchToTabIndex(1)),
      registerShortcut("switchTab3", () => switchToTabIndex(2)),
      registerShortcut("switchTab4", () => switchToTabIndex(3)),
      registerShortcut("switchTab5", () => switchToTabIndex(4)),
      registerShortcut("switchTab6", () => switchToTabIndex(5)),
      registerShortcut("switchTab7", () => switchToTabIndex(6)),
      registerShortcut("switchTab8", () => switchToTabIndex(7)),
      registerShortcut("switchTab9", () => switchToTabIndex(8)),
      registerShortcut("themeNext", () => cycleTheme()),
      registerShortcut("runSuperBrain", () => {
        const id = useWorkspaceStore.getState().activeTabId;
        console.log("[shortcut] runSuperBrain dispatched", { activeTabId: id });
        if (!id) {
          console.warn("[shortcut] runSuperBrain: no active tab");
          return;
        }
        void runSuperBrain(id);
      }),
    ];
    // Esc clears multi-pane selection. Use capture so we beat any per-component
    // Esc handlers (modal close, picker cancel) — but only consume the event
    // when a selection actually exists.
    const onEsc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const ws = useWorkspaceStore.getState();
      const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
      if (!tab || !tab.selectedPaneIds || tab.selectedPaneIds.length === 0) return;
      ws.clearPaneSelection(tab.id);
      e.stopPropagation();
      e.preventDefault();
    };
    window.addEventListener("keydown", onEsc, true);
    return () => {
      detach();
      window.removeEventListener("keydown", onEsc, true);
      unregisters.forEach((u) => u());
    };
  }, [newTab, closeTab, switchToTabIndex, cycleTheme, activeTabId]);

  return (
    <div className="app-root">
      <header className="app-titlebar" data-tauri-drag-region="deep">
        <TabBar />
      </header>
      <div className="app-body">
        <Sidebar />
        <div className="app-main">
          <div className="app-content">
            <div
              className="view-workspace"
              style={
                view === "workspace"
                  ? undefined
                  : { opacity: 0, pointerEvents: "none" }
              }
              aria-hidden={view !== "workspace"}
            >
              <WorkspaceView />
            </div>
            {view === "kanban" && <KanbanBoard />}
            {view === "agents" && <AgentManager />}
            {view === "settings" && <Settings />}
          </div>
          <StatusBar />
        </div>
      </div>
      <TemplatePicker />
      <QuickOpen />
      <SttBubble />
    </div>
  );
}
