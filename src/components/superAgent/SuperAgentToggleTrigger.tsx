import { useSuperAgentStore } from "../../stores/superAgentStore";
import { Icon } from "../ui/Icon";

export function SuperAgentToggleTrigger() {
  const open = useSuperAgentStore((s) => s.panelOpen);
  const setPanelOpen = useSuperAgentStore((s) => s.setPanelOpen);
  return (
    <button
      type="button"
      className={"btn btn-ghost btn-with-icon" + (open ? " active" : "")}
      onClick={() => setPanelOpen(!open)}
      title={open ? "Hide Super Agent panel" : "Show Super Agent panel"}
      aria-label={open ? "Hide Super Agent panel" : "Show Super Agent panel"}
      aria-pressed={open}
    >
      <Icon name="sparkles" size={14} />
      <span>Super Agent</span>
    </button>
  );
}
