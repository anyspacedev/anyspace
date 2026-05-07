import type { Agent } from "../../lib/types";
import { Icon } from "../ui/Icon";

export type AgentExample = Pick<Agent, "name" | "command" | "systemPrompt" | "envJson"> & {
  description: string;
};

const EXAMPLES: AgentExample[] = [
  {
    name: "Claude Code",
    command: "claude --resume {task_file}",
    systemPrompt: "",
    envJson: "{}",
    description:
      "Anthropic's CLI agent. Reads the task body from the rendered file and runs against the project cwd.",
  },
  {
    name: "Codex",
    command: "codex {task_file}",
    systemPrompt: "",
    envJson: "{}",
    description:
      "OpenAI's CLI agent. Same task-file convention. Set OPENAI_API_KEY in env if your shell doesn't already.",
  },
  {
    name: "Plain shell",
    command: "bash",
    systemPrompt: "",
    envJson: "{}",
    description:
      "An empty shell — useful when you want a workspace pane that the operator drives manually.",
  },
  {
    name: "Aider",
    command: "aider --message-file {task_file}",
    systemPrompt: "",
    envJson: "{}",
    description: "Pair-programming CLI; reads the task body as the initial message.",
  },
];

export function AgentExamples({
  onPick,
}: {
  onPick: (example: AgentExample) => void;
}) {
  return (
    <div className="agent-examples">
      <div className="agent-examples-title">
        <Icon name="sparkles" size={12} />
        <span>Start from an example</span>
      </div>
      <div className="agent-examples-list">
        {EXAMPLES.map((ex) => (
          <button
            key={ex.name}
            type="button"
            className="agent-example"
            onClick={() => onPick(ex)}
          >
            <div className="agent-example-name">{ex.name}</div>
            <code className="agent-example-cmd">{ex.command}</code>
            <div className="agent-example-desc">{ex.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
