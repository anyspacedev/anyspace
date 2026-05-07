import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useThemeStore } from "./stores/themeStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useKanbanStore } from "./stores/kanbanStore";
import { useSttStore } from "./stores/sttStore";
import { useAiStore } from "./stores/aiStore";
import { useProxyStore } from "./stores/proxyStore";
import { useTeamStore } from "./stores/teamStore";
import { useTeamSettingsStore } from "./stores/teamSettingsStore";
import { useNewWorkspacePickerStore } from "./stores/newWorkspacePickerStore";
import { NewWorkspacePickerHost } from "./components/workspace/NewWorkspacePicker";
import { attachGlobalShortcuts, registerShortcut } from "./lib/shortcuts";
import { runSuperBrain, toastSuperBrainResult } from "./lib/superBrain";
import { toast } from "./stores/toastStore";
import { resumeTeam } from "./lib/teamLauncher";
import { syncOperatorInboxSubscriptions } from "./lib/operatorInbox";
import { ensureAgentApi } from "./lib/agentApi";
import { startAgentApiBridge } from "./lib/agentApiBridge";
import { dispatchDropToPane } from "./components/terminal/terminalRegistry";
import { TabBar } from "./components/workspace/TabBar";
import { AccountStatus } from "./components/auth/AccountStatus";
import { Sidebar } from "./components/workspace/Sidebar";
import { WorkspaceView } from "./components/workspace/WorkspaceView";
import { KanbanBoard } from "./components/kanban/Board";
import { AgentManager } from "./components/agents/AgentManager";
import { Settings } from "./components/settings/Settings";
import { useSuperAgentStore } from "./stores/superAgentStore";
import { useSuperAgentSettingsStore } from "./stores/superAgentSettingsStore";
import { useRecentFoldersStore } from "./stores/recentFoldersStore";
import { useUiHintsStore } from "./stores/uiHintsStore";
import { StatusBar } from "./components/workspace/StatusBar";
import { QuickOpen } from "./components/sidebar/QuickOpen";
import { SttBubble } from "./components/stt/SttBubble";
import { ScreenshotStack } from "./components/screenshot/ScreenshotStack";
import { Toaster } from "./components/ui/Toaster";

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
  const loadTeams = useTeamStore((s) => s.load);
  const loadTeamSettings = useTeamSettingsStore((s) => s.load);
  const loadSuperAgent = useSuperAgentStore((s) => s.load);
  const loadSuperAgentSettings = useSuperAgentSettingsStore((s) => s.load);
  const loadRecentFolders = useRecentFoldersStore((s) => s.load);
  const loadUiHints = useUiHintsStore((s) => s.load);

  useEffect(() => {
    void loadTheme();
    void (async () => {
      await hydrateWorkspace();
      await loadKanban().catch((e) => console.warn("[kanban] load failed", e));
      await loadTeams().catch((e) => console.warn("[team] load failed", e));
      await loadTeamSettings().catch((e) => console.warn("[team] settings load failed", e));
      // Settings first — superAgent.load reads panelOpen + activeSessionId from
      // settings to restore the rail visibility and last session on relaunch.
      await loadSuperAgentSettings().catch((e) => console.warn("[super-agent] settings load failed", e));
      await loadSuperAgent().catch((e) => console.warn("[super-agent] load failed", e));
      // After both workspace + team data are in memory, resume any team tab
      // that survived the restart. resumeTeam re-renders prompt files and
      // re-injects pendingCommand into the existing panes.
      const teams = useTeamStore.getState().teams;
      const tabs = useWorkspaceStore.getState().tabs;
      for (const team of teams) {
        if (team.status !== "active" || !team.tabId) continue;
        if (!tabs.some((t) => t.id === team.tabId)) continue;
        try {
          await resumeTeam(team.id);
        } catch (err) {
          console.warn("[team] resume failed", team.id, err);
        }
      }
      // Hook up @operator inbox watchers for every active team. Subsequent
      // launches / archives are handled by the team-store subscriber below.
      await syncOperatorInboxSubscriptions().catch((e) =>
        console.warn("[operatorInbox] initial sync failed", e),
      );
    })();
    void loadStt().catch((e) => console.warn("[stt] load failed", e));
    void loadAi().catch((e) => console.warn("[ai] load failed", e));
    void loadProxy().catch((e) => console.warn("[proxy] load failed", e));
    void loadRecentFolders().catch((e) => console.warn("[recentFolders] load failed", e));
    void loadUiHints().catch((e) => console.warn("[uiHints] load failed", e));
    // Boot the agent_api bridge before any Code Agent terminal can spawn —
    // launchers read the cached URL+token to inject TEAMSHIP_API_URL/TOKEN
    // into the child env.
    void ensureAgentApi().catch((e) => console.warn("[agent_api] info load failed", e));
    void startAgentApiBridge().catch((e) => console.warn("[agent_api] bridge start failed", e));
  }, [loadTheme, hydrateWorkspace, loadKanban, loadStt, loadAi, loadProxy, loadTeams, loadTeamSettings, loadSuperAgent, loadSuperAgentSettings, loadRecentFolders, loadUiHints]);

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

  // When a team's tab is closed (manually via the X, or the last tab gone),
  // archive the team so resume on next launch doesn't try to re-spawn into
  // a tab that no longer exists. Subscribed once at the workspace-store level
  // so we don't entangle workspaceStore with team logic directly.
  useEffect(() => {
    const unsub = useWorkspaceStore.subscribe((state, prev) => {
      if (state.tabs === prev.tabs) return;
      const liveTabIds = new Set(state.tabs.map((t) => t.id));
      const teams = useTeamStore.getState().teams;
      for (const team of teams) {
        if (team.status !== "active" || !team.tabId) continue;
        if (!liveTabIds.has(team.tabId)) {
          void useTeamStore.getState().archive(team.id).catch((e) => {
            console.warn("[team] auto-archive on tab close failed", team.id, e);
          });
        }
      }
    });
    return unsub;
  }, []);

  // Re-sync @operator inbox subscriptions whenever the team list changes
  // (new launch, archive, reactivate). syncOperatorInboxSubscriptions is
  // idempotent — already-subscribed teams are skipped.
  useEffect(() => {
    const unsub = useTeamStore.subscribe((state, prev) => {
      if (state.teams === prev.teams) return;
      void syncOperatorInboxSubscriptions().catch((e) =>
        console.warn("[operatorInbox] resync failed", e),
      );
    });
    return unsub;
  }, []);

  useEffect(() => {
    const detach = attachGlobalShortcuts();
    const unregisters = [
      registerShortcut("newTab", () => newTab(1)),
      registerShortcut("newTeam", () => useNewWorkspacePickerStore.getState().openWith("team")),
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
          toast.warn("Suggest with AI: no active workspace", "Open a tab first.");
          return;
        }
        void runSuperBrain(id).then(toastSuperBrainResult).catch((e) => {
          console.error("[shortcut] runSuperBrain threw", e);
          toast.error(
            "Suggest with AI failed",
            e instanceof Error ? e.message : String(e),
          );
        });
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
      <Sidebar />
      <header className="app-titlebar" data-tauri-drag-region="">
        <TabBar />
        <AccountStatus />
      </header>
      <div className="app-main">
        <div className="app-content" data-view={view}>
          <div
            className="view-workspace view-fade"
            style={
              view === "workspace"
                ? undefined
                : { opacity: 0, pointerEvents: "none" }
            }
            aria-hidden={view !== "workspace"}
          >
            <WorkspaceView />
          </div>
          {view === "kanban" && (
            <div className="view-overlay view-fade" key="kanban">
              <KanbanBoard />
            </div>
          )}
          {view === "agents" && (
            <div className="view-overlay view-fade" key="agents">
              <AgentManager />
            </div>
          )}
          {view === "settings" && (
            <div className="view-overlay view-fade" key="settings">
              <Settings />
            </div>
          )}
        </div>
        <StatusBar />
      </div>
      <NewWorkspacePickerHost />
      <QuickOpen />
      <SttBubble />
      <ScreenshotStack />
      <Toaster />
    </div>
  );
}

