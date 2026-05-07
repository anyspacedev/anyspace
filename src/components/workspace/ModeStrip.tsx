import { useSttStore } from "../../stores/sttStore";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { usePickerStore } from "../../stores/pickerStore";
import { Icon, type IconName } from "../ui/Icon";

type Chip = {
  id: string;
  icon: IconName;
  label: string;
  /** Tone hints affect the left accent color. */
  tone: "danger" | "warn" | "info" | "accent";
  title?: string;
  onClick?: () => void;
};

/**
 * Canonical "what mode is this app in" surface, anchored at the left of the
 * status bar. Anything reading active = true on a mode store should add a
 * chip here so the user can see it from anywhere in the chrome.
 */
export function ModeStrip() {
  const sttPhase = useSttStore((s) => s.phase);
  const sttCancel = useSttStore((s) => s.cancel);
  const sttRemainingMs = useSttStore((s) => s.remainingMs);

  const pauseToolCalls = useSuperAgentStore((s) => s.pauseToolCalls);
  const setPauseToolCalls = useSuperAgentStore((s) => s.setPauseToolCalls);

  const tabs = useWorkspaceStore((s) => s.tabs);
  const activeTabId = useWorkspaceStore((s) => s.activeTabId);
  const clearPaneSelection = useWorkspaceStore((s) => s.clearPaneSelection);
  const tab = tabs.find((t) => t.id === activeTabId);
  const selectedCount = tab?.selectedPaneIds?.length ?? 0;

  const pickerActive = usePickerStore((s) => s.active);
  const cancelPicker = usePickerStore((s) => s.cancel);

  const chips: Chip[] = [];

  if (sttPhase === "listening") {
    const sec = Math.max(0, Math.ceil(sttRemainingMs / 1000));
    chips.push({
      id: "stt-listening",
      icon: "mic",
      label: `Listening · ${sec}s`,
      tone: "danger",
      title: "Release the hotkey to transcribe — Esc to cancel",
      onClick: () => sttCancel(),
    });
  } else if (sttPhase === "transcribing") {
    chips.push({
      id: "stt-transcribing",
      icon: "mic",
      label: "Transcribing…",
      tone: "info",
      title: "Sending audio to the configured STT provider",
    });
  }

  if (pickerActive) {
    chips.push({
      id: "picker",
      icon: "crosshair",
      label: "Picking element",
      tone: "info",
      title: "Click an element in the preview iframe — click here to cancel",
      onClick: () => cancelPicker(),
    });
  }

  if (pauseToolCalls) {
    chips.push({
      id: "sa-paused",
      icon: "alert-circle",
      label: "Tool calls paused",
      tone: "warn",
      title: "Super Agent tool calls require approval — click to resume auto",
      onClick: () => setPauseToolCalls(false),
    });
  }

  if (selectedCount >= 2 && tab) {
    chips.push({
      id: "broadcast",
      icon: "users-round",
      label: `Broadcasting · ${selectedCount}`,
      tone: "accent",
      title: "Keystrokes mirror to every selected pane — click to clear (Esc)",
      onClick: () => clearPaneSelection(tab.id),
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="mode-strip" role="group" aria-label="Active modes">
      {chips.map((c) => {
        const Element = c.onClick ? "button" : "span";
        return (
          <Element
            key={c.id}
            type={c.onClick ? "button" : undefined}
            className={`mode-chip mode-chip--${c.tone}`}
            title={c.title}
            onClick={c.onClick}
          >
            <Icon name={c.icon} size={11} />
            <span>{c.label}</span>
          </Element>
        );
      })}
    </div>
  );
}
