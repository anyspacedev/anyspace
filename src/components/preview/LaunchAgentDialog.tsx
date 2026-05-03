import { useEffect, useId, useMemo, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useKanbanStore } from "../../stores/kanbanStore";
import { launchAgent } from "../../lib/agentLauncher";
import {
  renderTaskBody,
  shortLabel,
  type ElementCapture,
} from "../../lib/elementContext";
import { useFocusReturn } from "../../lib/useFocusReturn";
import { useFocusTrap } from "../../lib/useFocusTrap";
import { Icon } from "../ui/Icon";
import { Select } from "../ui/Select";

type Props = {
  capture: ElementCapture;
  tabId: string;
  paneId: string;
  defaultCwd?: string;
  onClose: () => void;
};

export function LaunchAgentDialog({ capture, tabId, paneId, defaultCwd, onClose }: Props) {
  const agents = useKanbanStore((s) => s.agents);
  const createTask = useKanbanStore((s) => s.createTask);

  const [description, setDescription] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [cwd, setCwd] = useState(defaultCwd ?? "");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showDescError, setShowDescError] = useState(false);

  const titleId = useId();
  const descId = useId();
  const descErrorId = useId();
  const agentSelectId = useId();
  const cwdInputId = useId();

  useFocusReturn();
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(id);
  }, [toast]);

  const taskTitle = useMemo(() => {
    const head = description.trim().split(/\r?\n/)[0] ?? "";
    if (head) return head.slice(0, 60);
    return `Edit ${shortLabel(capture)}`;
  }, [description, capture]);

  const composedBody = useMemo(
    () => renderTaskBody(capture, description),
    [capture, description],
  );

  const hasDescription = description.trim().length > 0;
  const canRun = Boolean(agentId) && hasDescription && !busy;

  const tryClose = () => {
    if (busy) return;
    if (hasDescription) {
      const ok = window.confirm("Discard your description?");
      if (!ok) return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        tryClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // tryClose closes over hasDescription/busy — re-bind when those change.
  }, [hasDescription, busy]);

  const pickProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") setCwd(selected);
  };

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(composedBody);
      setToast("Copied to clipboard");
    } catch {
      setToast("Copy failed");
    }
  };

  const guardSubmit = (): boolean => {
    if (!hasDescription) {
      setShowDescError(true);
      return false;
    }
    if (!agentId) {
      setToast("Pick an agent first");
      return false;
    }
    return true;
  };

  const onRunNow = async () => {
    if (!guardSubmit()) return;
    setBusy(true);
    try {
      const ok = await launchAgent({
        mode: "current-tab",
        tabId,
        splitFromPaneId: paneId,
        splitDirection: "horizontal",
        agentId,
        taskTitle,
        taskBody: composedBody,
        taskColumn: "todo",
        cwd: cwd || undefined,
      });
      if (!ok) setToast("Agent not found");
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  const onAddToKanban = async () => {
    if (!guardSubmit()) return;
    setBusy(true);
    try {
      const task = await createTask({
        title: taskTitle,
        body: composedBody,
        agentId,
        projectPath: cwd || undefined,
        column: "in_progress",
      });
      const ok = await launchAgent({
        mode: "new-tab",
        agentId,
        taskId: task.id,
        taskTitle: task.title,
        taskBody: task.body,
        taskColumn: task.column,
        cwd: task.projectPath,
      });
      if (!ok) setToast("Agent not found");
      else onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={tryClose}>
      <div
        ref={modalRef}
        className="modal wide launch-agent-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="modal-close modal-close-floating"
          onClick={tryClose}
          aria-label="Close"
        >
          <Icon name="x" size={14} />
        </button>
        <h2 id={titleId} className="modal-title">Describe a change for this element</h2>

        <div className="captured-element">
          <div className="captured-selector">
            <Icon name="crosshair" size={12} />
            <code>{capture.selector || shortLabel(capture)}</code>
          </div>
          {capture.source && (
            <div className="captured-source">
              <Icon name="file" size={12} />
              <code>
                {capture.source.file}
                {capture.source.line !== undefined ? `:${capture.source.line}` : ""}
                {capture.source.column !== undefined ? `:${capture.source.column}` : ""}
              </code>
            </div>
          )}
          <pre className="captured-html">
            <code>{capture.outerHTML}</code>
          </pre>
          {capture.parents.length > 0 && (
            <div className="captured-parents">
              {capture.parents.map((p, i) => (
                <span key={i} className="captured-parent">
                  {p.tag}
                  {p.id ? `#${p.id}` : ""}
                  {p.classes.length ? "." + p.classes.slice(0, 2).join(".") : ""}
                  {i < capture.parents.length - 1 && (
                    <Icon name="chevron-right" size={10} />
                  )}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="form-row">
          <label className="label-with-icon" htmlFor={descId}>
            <Icon name="file-edit" size={12} />
            <span>What should the agent change?</span>
          </label>
          <textarea
            id={descId}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              if (e.target.value.trim().length > 0) setShowDescError(false);
            }}
            rows={4}
            placeholder="e.g. Make this button red and increase the font weight."
            aria-invalid={showDescError || undefined}
            aria-describedby={showDescError ? descErrorId : undefined}
            autoFocus
          />
          {showDescError && (
            <div id={descErrorId} className="form-error" role="alert">
              Add a short description so the agent knows what to change.
            </div>
          )}
        </div>

        <div className="form-row">
          <label className="label-with-icon" htmlFor={agentSelectId}>
            <Icon name="sparkles" size={12} />
            <span>Agent</span>
          </label>
          <Select id={agentSelectId} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
            {agents.length === 0 && <option value="">— no agents configured —</option>}
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </div>

        {!defaultCwd && (
          <div className="form-row">
            <label className="label-with-icon" htmlFor={cwdInputId}>
              <Icon name="folder" size={12} />
              <span>Project path</span>
            </label>
            <div className="form-row-inline">
              <input
                id={cwdInputId}
                value={cwd}
                onChange={(e) => setCwd(e.target.value)}
                placeholder="agent will run in this directory"
              />
              <button className="btn btn-ghost btn-with-icon" onClick={pickProject}>
                <Icon name="folder" size={14} />
                <span>Pick…</span>
              </button>
            </div>
          </div>
        )}

        <div className="modal-actions">
          {toast && (
            <div className="modal-toast" role="status" aria-live="polite">
              {toast}
            </div>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={tryClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-ghost btn-with-icon" onClick={onCopy} disabled={busy}>
            <Icon name="clipboard" size={14} />
            <span>Copy prompt</span>
          </button>
          <button className="btn btn-ghost btn-with-icon" onClick={onAddToKanban} disabled={!canRun}>
            <Icon name="list-checks" size={14} />
            <span>Add to Kanban &amp; run</span>
          </button>
          <button
            className="btn btn-primary btn-with-icon"
            onClick={onRunNow}
            disabled={!canRun}
            aria-busy={busy || undefined}
          >
            {busy ? <span className="btn-spinner" aria-hidden /> : <Icon name="play" size={14} />}
            <span>{busy ? "Launching…" : "Run now"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
