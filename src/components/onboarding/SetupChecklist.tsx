import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { useAiStore } from "../../stores/aiStore";
import { useKanbanStore } from "../../stores/kanbanStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useNewWorkspacePickerStore } from "../../stores/newWorkspacePickerStore";
import { useThemeStore } from "../../stores/themeStore";
import { Icon, type IconName } from "../ui/Icon";

type Step = {
  id: string;
  /** When true, the step is satisfied — green check. Optional steps stay
   *  neutral but show a "Configure" button to invite engagement. */
  done: boolean;
  optional?: boolean;
  icon: IconName;
  title: string;
  body: string;
  cta: { label: string; onClick: () => void; primary?: boolean };
};

/**
 * Replaces the legacy welcome card. Surfaces the dependency graph
 * (AI provider unlocks Suggest with AI / decompose; agents are required
 * for Run Task) so first-timers don't hit walls after clicking around.
 */
export function SetupChecklist() {
  const ai = useAiStore((s) => s.settings);
  const aiLoaded = useAiStore((s) => s.loaded);
  const agents = useKanbanStore((s) => s.agents);
  const setView = useWorkspaceStore((s) => s.setView);
  const newTab = useWorkspaceStore((s) => s.newTab);
  const openPickerWith = useNewWorkspacePickerStore((s) => s.openWith);
  const theme = useThemeStore((s) => s.resolved);

  const aiConfigured =
    !!ai.endpoint && !!ai.apiKey && !!ai.model;
  const hasAgent = agents.length > 0;

  const steps: Step[] = [
    {
      id: "ai",
      done: aiConfigured,
      icon: "sparkles",
      title: "Configure your AI provider",
      body:
        "Unlocks Suggest with AI, command Explain, team decompose, and the Super Agent chat.",
      cta: {
        label: aiConfigured ? "Edit AI settings" : "Set up AI",
        onClick: () => setView("settings"),
        primary: !aiConfigured,
      },
    },
    {
      id: "agent",
      done: hasAgent,
      icon: "terminal",
      title: "Create your first agent",
      body:
        "Agents are CLI command templates (e.g. claude, codex, plain shell) that Run Task spawns into a terminal pane.",
      cta: {
        label: hasAgent ? "Manage agents" : "Create an agent",
        onClick: () => setView("agents"),
        primary: aiConfigured && !hasAgent,
      },
    },
    {
      id: "folder",
      done: false,
      optional: true,
      icon: "folder-tree",
      title: "Pick a project folder (optional)",
      body:
        "Sets cwd for terminals, root for the file browser, and target for live preview. You can add this later from any tab.",
      cta: {
        label: "Pick folder",
        onClick: async () => {
          const sel = await openDialog({ directory: true, multiple: false });
          if (typeof sel === "string") {
            // Create a one-pane tab anchored to the chosen folder.
            void newTab(1, undefined, undefined, sel);
          }
        },
      },
    },
  ];

  const allRequiredDone = steps
    .filter((s) => !s.optional)
    .every((s) => s.done);

  return (
    <div className="welcome">
      <div className="welcome-card setup-card">
        <div
          className="welcome-mark"
          style={{
            background: `linear-gradient(135deg, ${theme.ui.accent}, ${theme.ui.info})`,
            color: theme.ui.accentFg,
          }}
        >
          T
        </div>
        <h1 className="welcome-title">Welcome to AnySpace</h1>
        <div className="welcome-sub">
          Two quick steps to unlock everything. Skip what you don't need —
          you can always come back from <kbd>⌘,</kbd> Settings.
        </div>

        <ul className="setup-list" role="list">
          {steps.map((s, idx) => (
            <li
              key={s.id}
              className={
                "setup-item" +
                (s.done ? " setup-item--done" : "") +
                (s.optional ? " setup-item--optional" : "")
              }
            >
              <span className="setup-item-status" aria-hidden="true">
                {s.done ? (
                  <Icon name="check" size={14} />
                ) : (
                  <span className="setup-item-num">{idx + 1}</span>
                )}
              </span>
              <div className="setup-item-text">
                <div className="setup-item-title">
                  <Icon name={s.icon} size={12} />
                  <span>{s.title}</span>
                  {s.optional && <span className="setup-item-tag">optional</span>}
                </div>
                <div className="setup-item-body">{s.body}</div>
              </div>
              <button
                type="button"
                className={
                  "btn btn-with-icon " +
                  (s.cta.primary ? "btn-primary" : s.done ? "btn-ghost" : "btn-secondary")
                }
                onClick={s.cta.onClick}
              >
                <span>{s.cta.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="setup-launch-row">
          <div className="setup-launch-label">
            {allRequiredDone ? "Ready to launch" : "Or jump in now"}
          </div>
          <div className="welcome-actions">
            <button
              className="btn btn-primary btn-with-icon"
              onClick={() => newTab(1)}
            >
              <Icon name="terminal" size={14} />
              <span>Open Terminal</span>
            </button>
            <button
              className="btn btn-with-icon"
              onClick={() => openPickerWith("team")}
              disabled={!aiLoaded}
              title={!aiConfigured ? "AI provider unlocks the team decompose helper" : undefined}
            >
              <Icon name="users-round" size={14} />
              <span>Start team</span>
            </button>
            <button
              className="btn btn-with-icon"
              onClick={() => setView("kanban")}
            >
              <Icon name="list-checks" size={14} />
              <span>Browse tasks</span>
            </button>
          </div>
        </div>

        <div className="welcome-hints">
          <div className="welcome-hint">
            <kbd>⌘T</kbd>
            <span>New tab</span>
          </div>
          <div className="welcome-hint">
            <kbd>⌘P</kbd>
            <span>Quick open</span>
          </div>
          <div className="welcome-hint">
            <kbd>⌘D</kbd>
            <span>Split pane</span>
          </div>
          <div className="welcome-hint">
            <kbd>⌘⇧B</kbd>
            <span>Suggest with AI</span>
          </div>
        </div>
      </div>
    </div>
  );
}
