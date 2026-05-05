import { useEffect, useId, useRef } from "react";
import { useNewWorkspacePickerStore, type NewWorkspacePickerMode } from "../../stores/newWorkspacePickerStore";
import { useFocusReturn } from "../../lib/useFocusReturn";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { TemplatePickerForm } from "./TemplatePicker";
import { TeamPickerForm } from "./TeamPicker";
import { TeamRowList } from "../team/TeamRowList";
import { Icon } from "../ui/Icon";

export function NewWorkspacePickerTrigger() {
  const openWith = useNewWorkspacePickerStore((s) => s.openWith);
  return (
    <button
      className="btn btn-ghost btn-with-icon"
      onClick={() => openWith("menu")}
      title="New workspace"
    >
      <Icon name="plus" size={14} />
      <span>New Workspace</span>
    </button>
  );
}

export function NewWorkspacePickerHost() {
  const open = useNewWorkspacePickerStore((s) => s.open);
  const mode = useNewWorkspacePickerStore((s) => s.mode);
  const setMode = useNewWorkspacePickerStore((s) => s.setMode);
  const close = useNewWorkspacePickerStore((s) => s.close);

  const titleId = useId();
  const modalRef = useRef<HTMLDivElement>(null);

  useFocusReturn(open);
  useFocusTrap(modalRef, open);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  const isPinned = mode === "team";

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        ref={modalRef}
        className={"modal wide" + (isPinned ? " pinned" : "")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        {mode !== "menu" && (
          <button
            type="button"
            className="modal-back modal-back-floating"
            onClick={() => setMode("menu")}
            aria-label="Back to options"
            title="Back to options"
          >
            <Icon name="chevron-left" size={14} />
            <span>Options</span>
          </button>
        )}
        <button
          type="button"
          className="modal-close modal-close-floating"
          onClick={close}
          aria-label="Close"
        >
          <Icon name="x" size={14} />
        </button>

        {mode === "menu" && <MenuBody titleId={titleId} setMode={setMode} />}
        {mode === "quick" && <TemplatePickerForm onClose={close} titleId={titleId} />}
        {mode === "team" && <TeamPickerForm onClose={close} titleId={titleId} />}
        {mode === "saved" && <SavedBody titleId={titleId} onClose={close} />}
      </div>
    </div>
  );
}

function MenuBody({ titleId, setMode }: { titleId: string; setMode: (m: NewWorkspacePickerMode) => void }) {
  return (
    <>
      <h2 id={titleId} className="modal-title">New workspace</h2>
      <div className="modal-sub">
        Pick how you want to start. A team is a workspace with multiple agents working
        toward a shared goal.
      </div>
      <div className="nws-card-grid">
        <button
          type="button"
          className="nws-intent-card"
          onClick={() => setMode("quick")}
        >
          <span className="nws-intent-icon">
            <Icon name="plus" size={20} />
          </span>
          <span className="nws-intent-title">Quick start</span>
          <span className="nws-intent-sub">
            Pick a layout template, optionally assign agents per pane, launch.
          </span>
        </button>
        <button
          type="button"
          className="nws-intent-card"
          onClick={() => setMode("team")}
        >
          <span className="nws-intent-icon">
            <Icon name="users-round" size={20} />
          </span>
          <span className="nws-intent-title">Multi-agent team</span>
          <span className="nws-intent-sub">
            Define a goal, assemble a roster, persist BOARD.md / MESSAGES.md
            so agents can coordinate.
          </span>
        </button>
      </div>
      <div className="nws-saved-link-row">
        <button
          type="button"
          className="nws-saved-link"
          onClick={() => setMode("saved")}
        >
          View saved workspaces
          <Icon name="chevron-right" size={12} />
        </button>
      </div>
    </>
  );
}

function SavedBody({ titleId, onClose }: { titleId: string; onClose: () => void }) {
  return (
    <>
      <h2 id={titleId} className="modal-title">Saved workspaces</h2>
      <div className="modal-sub">
        Multi-agent teams persist across restarts. Open or reactivate one,
        rename it, or archive teams you're done with.
      </div>
      <TeamRowList onActivated={onClose} />
    </>
  );
}
