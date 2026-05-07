import { useEffect, useId, useRef, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useFocusReturn } from "../../lib/useFocusReturn";
import { useFocusTrap } from "../../lib/useFocusTrap";
import type { Task } from "../../lib/types";
import { Icon } from "../ui/Icon";
import { Select } from "../ui/Select";
import { suggestKanbanTask } from "../../lib/aiSuggest/kanbanTask";
import { AiSuggestNotConfiguredError } from "../../lib/aiSuggest/runner";

export function TaskEditor({
  task,
  onClose,
  focusAgent,
}: {
  task?: Task;
  onClose: () => void;
  /** When true, scroll to and focus the agent dropdown — used when Run was
   *  attempted without an agent so the user lands on the field that needs them. */
  focusAgent?: boolean;
}) {
  useFocusReturn();
  const modalRef = useRef<HTMLDivElement>(null);
  useFocusTrap(modalRef);
  const create = useKanbanStore((s) => s.createTask);
  const update = useKanbanStore((s) => s.updateTask);
  const remove = useKanbanStore((s) => s.deleteTask);
  const agents = useKanbanStore((s) => s.agents);

  const [title, setTitle] = useState(task?.title ?? "");
  const [body, setBody] = useState(task?.body ?? "");
  const [agentId, setAgentId] = useState(task?.agentId ?? "");
  const [projectPath, setProjectPath] = useState(task?.projectPath ?? "");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestNeedsConfig, setSuggestNeedsConfig] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const setView = useWorkspaceStore((s) => s.setView);

  const titleId = useId();
  const titleInputId = useId();
  const bodyInputId = useId();
  const agentSelectId = useId();
  const projectInputId = useId();
  const agentSelectRef = useRef<HTMLSelectElement>(null);

  // When opened from a Run-without-agent click, focus the field that's blocking
  // launch so the user sees what to fix.
  useEffect(() => {
    if (!focusAgent) return;
    const t = window.setTimeout(() => {
      agentSelectRef.current?.focus();
      agentSelectRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    return () => window.clearTimeout(t);
  }, [focusAgent]);

  // Dirty if user has typed anything (new task) or changed something (edit).
  const dirty = task
    ? title !== (task.title ?? "") ||
      body !== (task.body ?? "") ||
      agentId !== (task.agentId ?? "") ||
      projectPath !== (task.projectPath ?? "")
    : title.trim().length > 0 || body.trim().length > 0;

  const tryClose = () => {
    if (dirty) {
      const ok = window.confirm("Discard changes?");
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
  }, [dirty]);

  const save = async () => {
    if (!title.trim()) return;
    if (task) {
      await update(task.id, { title, body, agentId: agentId || undefined, projectPath: projectPath || undefined });
    } else {
      await create({ title, body, agentId: agentId || undefined, projectPath: projectPath || undefined });
    }
    onClose();
  };

  const pickProject = async () => {
    const selected = await openDialog({ directory: true, multiple: false });
    if (typeof selected === "string") setProjectPath(selected);
  };

  const runSuggest = async () => {
    console.log("[suggestWithAi:kanban] click", {
      titleLen: title.trim().length,
      hasBody: body.trim().length > 0,
      agents: agents.length,
    });
    if (!title.trim() || suggesting) return;
    setSuggestError(null);
    setSuggestNote(null);
    setSuggestNeedsConfig(false);
    setSuggesting(true);
    try {
      const out = await suggestKanbanTask({
        title,
        agents: agents.map((a) => ({ id: a.id, name: a.name, command: a.command })),
        existingBody: body || undefined,
      });
      setBody(out.body);
      if (out.agentId && !agentId) setAgentId(out.agentId);
      if (out.notes) setSuggestNote(out.notes);
    } catch (err) {
      console.error("[suggestWithAi:kanban] caught", err);
      if (err instanceof AiSuggestNotConfiguredError) {
        setSuggestNeedsConfig(true);
        setSuggestError(err.message);
      } else {
        setSuggestError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setSuggesting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={tryClose}>
      <div
        ref={modalRef}
        className="modal task-editor"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <h2 id={titleId} className="modal-title">{task ? "Edit task" : "New task"}</h2>
          <button
            type="button"
            className="modal-close"
            onClick={tryClose}
            aria-label="Close"
          >
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={titleInputId}>
            <Icon name="file-edit" size={12} />
            <span>Title</span>
          </label>
          <input id={titleInputId} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={bodyInputId}>
            <Icon name="list-checks" size={12} />
            <span>Body</span>
          </label>
          <textarea id={bodyInputId} value={body} onChange={(e) => setBody(e.target.value)} rows={6} />
          <div
            className="form-row-inline"
            style={{ justifyContent: "flex-end", marginTop: 6 }}
          >
            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={runSuggest}
              disabled={suggesting || !title.trim()}
              title={
                !title.trim()
                  ? "Type a title first to enable AI suggestions"
                  : "Ask the configured AI to draft the body and pick an agent"
              }
            >
              <Icon name="sparkles" size={12} />
              <span>{suggesting ? "Thinking…" : "Suggest with AI"}</span>
            </button>
          </div>
          {!title.trim() && !suggestError && (
            <div className="form-hint">Type a title above to enable AI suggestions.</div>
          )}
          {suggestError && (
            <div className="form-hint form-hint-error">
              AI: {suggestError}
              {suggestNeedsConfig && (
                <>
                  {" — "}
                  <button
                    type="button"
                    className="team-section-link"
                    onClick={() => {
                      setView("settings");
                      onClose();
                    }}
                  >
                    Open Settings → AI
                  </button>
                </>
              )}
            </div>
          )}
          {suggestNote && <div className="form-hint">AI: {suggestNote}</div>}
        </div>
        <div className={"form-row" + (focusAgent && !agentId ? " form-row--needs" : "")}>
          <label className="label-with-icon" htmlFor={agentSelectId}>
            <Icon name="sparkles" size={12} />
            <span>Agent</span>
            {focusAgent && !agentId && (
              <span className="form-row-tag">required to Run</span>
            )}
          </label>
          <div className="form-row-inline">
            <Select
              id={agentSelectId}
              ref={agentSelectRef}
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
            >
              <option value="">— none —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </Select>
            <button
              type="button"
              className="btn btn-ghost btn-with-icon"
              onClick={() => {
                setView("agents");
                onClose();
              }}
              title={
                agents.length === 0
                  ? "Create your first agent — opens the Agents view"
                  : "Open the Agents view to add or edit an agent"
              }
            >
              <Icon name="plus" size={12} />
              <span>{agents.length === 0 ? "Create agent" : "Manage agents"}</span>
            </button>
          </div>
          {agents.length === 0 && (
            <div className="form-hint">
              Run Task spawns the chosen agent's command in a terminal pane.
              Define one in <button
                type="button"
                className="team-section-link"
                onClick={() => { setView("agents"); onClose(); }}
              >Agents</button> first.
            </div>
          )}
        </div>
        <div className="form-row">
          <label className="label-with-icon" htmlFor={projectInputId}>
            <Icon name="folder" size={12} />
            <span>Project path</span>
          </label>
          <div className="form-row-inline">
            <input id={projectInputId} value={projectPath} onChange={(e) => setProjectPath(e.target.value)} placeholder="optional" />
            <button className="btn btn-ghost btn-with-icon" onClick={pickProject}>
              <Icon name="folder" size={14} />
              <span>Pick…</span>
            </button>
          </div>
        </div>
        <div className="modal-actions">
          {task && (
            <button className="btn btn-danger" onClick={async () => { await remove(task.id); onClose(); }}>
              Delete
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button className="btn btn-ghost" onClick={tryClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>Save</button>
        </div>
      </div>
    </div>
  );
}
