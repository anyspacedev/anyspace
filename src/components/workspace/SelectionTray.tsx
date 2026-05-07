import { useWorkspaceStore } from "../../stores/workspaceStore";
import { runSuperBrain, toastSuperBrainResult } from "../../lib/superBrain";
import { Icon } from "../ui/Icon";

/**
 * Floating tray near the top of the workspace, visible whenever 2+ panes are
 * Cmd-click selected. Surfaces the broadcast affordance plus the actions
 * that operate on the whole selection (Suggest with AI, clear).
 */
export function SelectionTray() {
  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const clearPaneSelection = useWorkspaceStore((s) => s.clearPaneSelection);
  const tab = tabs.find((t) => t.id === activeTabId);
  const count = tab?.selectedPaneIds?.length ?? 0;
  if (!tab || count < 2) return null;

  const suggestAll = () => {
    void runSuperBrain(tab.id).then(toastSuperBrainResult);
  };

  return (
    <div className="selection-tray" role="toolbar" aria-label="Selected panes">
      <span className="selection-tray-count">
        <span className="selection-tray-dot" aria-hidden="true" />
        <span>{count} panes selected</span>
      </span>
      <span className="selection-tray-hint">
        Typing fans out to all · <kbd>Esc</kbd> clears
      </span>
      <div className="selection-tray-actions">
        <button
          type="button"
          className="btn btn-ghost btn-with-icon"
          onClick={suggestAll}
          title="Suggest the next command in every selected terminal pane"
        >
          <Icon name="sparkles" size={12} />
          <span>Suggest in all</span>
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-with-icon"
          onClick={() => clearPaneSelection(tab.id)}
        >
          <Icon name="x" size={12} />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
}
