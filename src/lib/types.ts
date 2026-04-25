// Shared types for tabs, panes, kanban, agents.

export type PaneKind = "terminal" | "editor" | "preview" | "filebrowser" | "empty";

export type Pane = {
  id: string;
  kind: PaneKind;
  // For editor: which file is open. For preview: which URL. For terminal: assigned sessionId.
  payload?: Record<string, unknown>;
};

export type LayoutNode =
  | { type: "leaf"; paneId: string }
  | {
      type: "split";
      direction: "horizontal" | "vertical";
      sizes: number[];
      children: LayoutNode[];
    };

export type Tab = {
  id: string;
  name: string;
  color?: string;
  layout: LayoutNode;
  panes: Record<string, Pane>;
  activePaneId?: string;
};

export type Task = {
  id: string;
  title: string;
  body: string;
  column: "todo" | "in_progress" | "in_review" | "complete";
  agentId?: string;
  projectPath?: string;
  ordinal: number;
  createdAt: number;
  updatedAt: number;
};

export type Agent = {
  id: string;
  name: string;
  command: string;
  systemPrompt: string;
  envJson: string;
};

export const COLUMNS: Task["column"][] = ["todo", "in_progress", "in_review", "complete"];

export const COLUMN_LABEL: Record<Task["column"], string> = {
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  complete: "Complete",
};
