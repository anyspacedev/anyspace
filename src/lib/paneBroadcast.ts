// Fan-out helper for synchronous keystroke broadcast across selected panes.
// Mirrors every byte the active terminal emits to every other selected
// terminal pane in the active tab. Single-pane sessions short-circuit at
// the top — the registered onData wrapper pays no cost when broadcast is off.

import { useWorkspaceStore } from "../stores/workspaceStore";
import { ptyWrite } from "./tauri";

export function broadcastBytes(originPaneId: string, bytes: Uint8Array): void {
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (!tab) return;
  const sel = tab.selectedPaneIds ?? [];
  if (sel.length < 2) return;
  if (!sel.includes(originPaneId)) return;
  for (const id of sel) {
    if (id === originPaneId) continue;
    const pane = tab.panes[id];
    if (!pane || pane.kind !== "terminal") continue;
    const sid = pane.payload?.sessionId as string | undefined;
    if (!sid) continue;
    void ptyWrite(sid, bytes).catch(() => {});
  }
}
