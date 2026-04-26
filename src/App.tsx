import { useEffect } from "react";
import { useThemeStore } from "./stores/themeStore";
import { useWorkspaceStore } from "./stores/workspaceStore";
import { useKanbanStore } from "./stores/kanbanStore";
import { useSttStore } from "./stores/sttStore";
import { useAiStore } from "./stores/aiStore";
import { attachGlobalShortcuts, registerShortcut } from "./lib/shortcuts";
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

  useEffect(() => {
    void loadTheme();
    void hydrateWorkspace();
    void loadKanban().catch((e) => console.warn("[kanban] load failed", e));
    void loadStt().catch((e) => console.warn("[stt] load failed", e));
    void loadAi().catch((e) => console.warn("[ai] load failed", e));
  }, [loadTheme, hydrateWorkspace, loadKanban, loadStt, loadAi]);

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
    ];
    return () => {
      detach();
      unregisters.forEach((u) => u());
    };
  }, [newTab, closeTab, switchToTabIndex, cycleTheme, activeTabId]);

  return (
    <div className="app-root">
      <Sidebar />
      <div className="app-main">
        <TabBar />
        <div className="app-content">
          <div
            className="view-workspace"
            style={view === "workspace" ? undefined : { display: "none" }}
          >
            <WorkspaceView />
          </div>
          {view === "kanban" && <KanbanBoard />}
          {view === "agents" && <AgentManager />}
          {view === "settings" && <Settings />}
        </div>
        <StatusBar />
      </div>
      <TemplatePicker />
      <QuickOpen />
      <SttBubble />
    </div>
  );
}
