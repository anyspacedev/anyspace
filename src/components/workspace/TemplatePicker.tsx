import { useState } from "react";
import { TEMPLATES, useWorkspaceStore } from "../../stores/workspaceStore";

export function TemplatePickerTrigger() {
  const [open, setOpen] = useState(false);
  const newTab = useWorkspaceStore((s) => s.newTab);

  return (
    <>
      <button className="btn btn-ghost" onClick={() => setOpen(true)} title="New workspace (Cmd+T)">
        + Workspace
      </button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-title">New workspace</div>
            <div className="modal-sub">Choose a pane layout — terminals will spawn in parallel.</div>
            <div className="template-grid">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  className="template-card"
                  onClick={() => {
                    newTab(t.panes, t.label);
                    setOpen(false);
                  }}
                >
                  <TemplatePreview panes={t.panes} />
                  <div className="template-label">{t.label}</div>
                  <div className="template-sub">{t.panes} pane{t.panes === 1 ? "" : "s"}</div>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function TemplatePreview({ panes }: { panes: number }) {
  let cols = 1;
  let rows = 1;
  if (panes === 2) { cols = 2; rows = 1; }
  else if (panes === 4) { cols = 2; rows = 2; }
  else if (panes === 6) { cols = 3; rows = 2; }
  else if (panes === 8) { cols = 4; rows = 2; }
  else if (panes === 9) { cols = 3; rows = 3; }
  else if (panes === 12) { cols = 4; rows = 3; }
  else if (panes === 16) { cols = 4; rows = 4; }

  return (
    <div
      className="template-preview"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {Array.from({ length: panes }, (_, i) => (
        <div key={i} className="template-cell" />
      ))}
    </div>
  );
}

// Empty marker export so Vite tree-shakes the trigger when unused.
export function TemplatePicker() {
  return null;
}
