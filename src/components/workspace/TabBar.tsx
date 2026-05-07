import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTeamStore } from "../../stores/teamStore";
import { useRecentFoldersStore } from "../../stores/recentFoldersStore";
import { useState, useMemo, useEffect, useRef } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { NewWorkspacePickerTrigger } from "./NewWorkspacePicker";
import { Icon } from "../ui/Icon";

function pathBasename(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "");
  const last = trimmed.split(/[/\\]/).pop() ?? trimmed;
  return last || trimmed;
}

function pathParent(p: string): string {
  const trimmed = p.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx > 0 ? trimmed.slice(0, idx) : "";
}

export function TabBar() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const view = useWorkspaceStore((s) => s.selectedView);
  const renameTab = useWorkspaceStore((s) => s.renameTab);
  const setTabProjectPath = useWorkspaceStore((s) => s.setTabProjectPath);
  const teams = useTeamStore((s) => s.teams);
  const recents = useRecentFoldersStore((s) => s.recents);
  const pushRecent = useRecentFoldersStore((s) => s.push);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const folderMenuRef = useRef<HTMLDivElement>(null);
  const tabsStripRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<
    { tabId: string; x: number; y: number } | null
  >(null);

  // Close the tab context menu on outside click / Escape / scroll.
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  const closeOthers = (keepId: string) => {
    for (const t of tabs) if (t.id !== keepId) closeTab(t.id);
    setContextMenu(null);
  };

  const teamTabIds = useMemo(() => {
    const set = new Set<string>();
    for (const t of teams) if (t.tabId) set.add(t.tabId);
    return set;
  }, [teams]);

  // Once tabs load, seed the recents store with any project paths we already
  // know about — gives the menu something to show on first launch instead of
  // an empty list.
  useEffect(() => {
    for (const t of tabs) if (t.projectPath) void pushRecent(t.projectPath);
  }, [tabs, pushRecent]);

  // Convert vertical wheel deltas into horizontal scroll on the tabs strip.
  // React's onWheel is passive so it can't preventDefault — register manually.
  useEffect(() => {
    const el = tabsStripRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (e.shiftKey) return; // user is already requesting horizontal
      const dx = e.deltaX;
      const dy = e.deltaY;
      if (Math.abs(dy) <= Math.abs(dx)) return; // already horizontal
      if (el.scrollWidth <= el.clientWidth) return; // nothing to scroll
      e.preventDefault();
      el.scrollLeft += dy;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Close the folder popover on outside click / Escape.
  useEffect(() => {
    if (!folderMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (folderMenuRef.current && !folderMenuRef.current.contains(e.target as Node)) {
        setFolderMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFolderMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [folderMenuOpen]);

  const setActiveProjectPath = async (path: string) => {
    if (!activeTab) return;
    setTabProjectPath(activeTab.id, path);
    void pushRecent(path);
    setFolderMenuOpen(false);
  };

  const pickWorkspaceFolder = async () => {
    if (!activeTab) return;
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: activeTab.projectPath,
      title: "Choose workspace folder",
    });
    if (typeof selected === "string") void setActiveProjectPath(selected);
  };

  if (view !== "workspace") {
    const setView = useWorkspaceStore.getState().setView;
    const liveTabCount = tabs.length;
    return (
      <div className="tabbar" data-tauri-drag-region="">
        <div className="tabbar-title" data-tauri-drag-region="">
          {view === "kanban" && "Task Board"}
          {view === "agents" && "Agents"}
          {view === "settings" && "Settings"}
        </div>
        {liveTabCount > 0 && (
          <button
            type="button"
            className="back-to-workspace-pill"
            onClick={() => setView("workspace")}
            title={`Return to ${liveTabCount} open workspace tab${liveTabCount === 1 ? "" : "s"}`}
          >
            <Icon name="chevron-left" size={12} />
            <span>
              {liveTabCount} workspace{liveTabCount === 1 ? "" : "s"}
            </span>
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="tabbar" data-tauri-drag-region="">
      <div className="tabbar-tabs scrollbar" ref={tabsStripRef} data-tauri-drag-region="">
        {tabs.map((tab) => {
          const isTeam = teamTabIds.has(tab.id);
          return (
            <div
              key={tab.id}
              className={"tab" + (tab.id === activeTabId ? " active" : "")}
              aria-current={tab.id === activeTabId ? "page" : undefined}
              onClick={() => setActiveTab(tab.id)}
              onDoubleClick={() => setEditingId(tab.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                setActiveTab(tab.id);
                setContextMenu({ tabId: tab.id, x: e.clientX, y: e.clientY });
              }}
            >
              <span className="tab-color" style={{ background: tab.color }} />
              {isTeam && (
                <span className="tab-team-badge" aria-label="Team workspace" title="Team workspace">
                  <Icon name="users-round" size={12} />
                </span>
              )}
              {editingId === tab.id ? (
                <input
                  autoFocus
                  aria-label="Rename tab"
                  className="tab-name-input"
                  defaultValue={tab.name}
                  onBlur={(e) => {
                    renameTab(tab.id, e.target.value || tab.name);
                    setEditingId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      renameTab(tab.id, (e.target as HTMLInputElement).value || tab.name);
                      setEditingId(null);
                    }
                    if (e.key === "Escape") setEditingId(null);
                  }}
                />
              ) : (
                <span className="tab-name">{tab.name}</span>
              )}
              <button
                className="tab-close"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <Icon name="x" size={12} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tabbar-actions" data-tauri-drag-region="">
        {activeTab && (
          <div className="folder-pill-wrap" ref={folderMenuRef}>
            <button
              type="button"
              className={"workspace-folder-pill" + (activeTab.projectPath ? " is-set" : "")}
              onClick={() => {
                if (recents.length === 0 && !activeTab.projectPath) {
                  void pickWorkspaceFolder();
                } else {
                  setFolderMenuOpen((v) => !v);
                }
              }}
              aria-haspopup="menu"
              aria-expanded={folderMenuOpen}
              title={
                activeTab.projectPath
                  ? `Project: ${activeTab.projectPath}\nSets cwd for terminals, root for File Browser, target for Live Preview.`
                  : "Pick a project folder — sets cwd for terminals, root for File Browser, target for Live Preview."
              }
              aria-label={
                activeTab.projectPath
                  ? `Change project folder (current: ${activeTab.projectPath})`
                  : "Pick project folder"
              }
            >
              <Icon name="folder-tree" size={13} />
              <span className="workspace-folder-pill-text">
                {activeTab.projectPath ? pathBasename(activeTab.projectPath) : "Pick project…"}
              </span>
              {(recents.length > 0 || activeTab.projectPath) && (
                <Icon name="chevron-down" size={11} />
              )}
            </button>
            {folderMenuOpen && (
              <div className="folder-menu" role="menu">
                <button
                  type="button"
                  className="folder-menu-row folder-menu-row--primary"
                  onClick={pickWorkspaceFolder}
                  role="menuitem"
                >
                  <Icon name="folder" size={13} />
                  <span>Pick another folder…</span>
                </button>
                {recents.length > 0 && (
                  <>
                    <div className="folder-menu-section">Recent</div>
                    {recents.map((p) => {
                      const parent = pathParent(p);
                      const base = pathBasename(p);
                      return (
                        <button
                          key={p}
                          type="button"
                          className={
                            "folder-menu-row" +
                            (activeTab.projectPath === p ? " folder-menu-row--active" : "")
                          }
                          onClick={() => void setActiveProjectPath(p)}
                          role="menuitem"
                          title={p}
                        >
                          <Icon name="folder-tree" size={13} />
                          <div className="folder-menu-row-text">
                            <div className="folder-menu-row-name">{base}</div>
                            {parent && <div className="folder-menu-row-path">{parent}</div>}
                          </div>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        )}
        <NewWorkspacePickerTrigger />
      </div>
      {contextMenu && (
        <div
          className="tab-context-menu"
          role="menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="tab-context-row"
            role="menuitem"
            onClick={() => {
              setEditingId(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            <Icon name="file-edit" size={12} />
            <span>Rename</span>
          </button>
          <button
            type="button"
            className="tab-context-row"
            role="menuitem"
            disabled={tabs.length <= 1}
            onClick={() => closeOthers(contextMenu.tabId)}
          >
            <Icon name="x" size={12} />
            <span>Close other tabs</span>
          </button>
          <button
            type="button"
            className="tab-context-row tab-context-row--danger"
            role="menuitem"
            onClick={() => {
              closeTab(contextMenu.tabId);
              setContextMenu(null);
            }}
          >
            <Icon name="x" size={12} />
            <span>Close tab</span>
          </button>
        </div>
      )}
    </div>
  );
}
