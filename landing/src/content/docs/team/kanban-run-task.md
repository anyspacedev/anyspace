---
title: Kanban & Run Task
description: A board for tracking AI agent work, and the launcher that spawns an agent against a task.
section: team
order: 10
updated: 2026-05-09
---

The Kanban board is AnySpace's task tracker for AI agents. It looks like a normal four-column board (Todo / In Progress / In Review / Complete), but each card carries an **agent assignment**. When you click **Run**, AnySpace spawns the agent's CLI in a fresh terminal, hands it the task body, and tracks the run.

## Opening the board

Click **Kanban** in the sidebar. Tasks are stored locally in SQLite (`anyspace.db` in your AnySpace data dir) and persist across restarts.

## Creating a task

Click **New task**. Fill in:

- **Title** — short summary, shown on the card.
- **Body** — the actual prompt the agent will receive. Markdown is fine; agents see the raw content.
- **Agent** — which CLI program to run. Pick from the **Agents** view (see below).
- **Project folder** — defaults to whichever tab is active.

Tasks can be edited inline by double-clicking, dragged between columns, and reordered within a column.

## Defining an Agent

An "Agent" in AnySpace is just a CLI program — Claude Code, Codex, OpenHands, your own bash script, anything. Open **Agents** in the sidebar, click **New agent**, and define:

- **Name** — shown in pickers.
- **Command** — the shell command. Use `{task_file}` to substitute the path to the task body file.
- **System prompt** — prepended to the task body when AnySpace assembles the file.
- **Env JSON** — environment variables, JSON object form.

Example command for Claude Code:

```bash
claude --print "$(cat {task_file})"
```

Example for a script that reads `$ANYSPACE_TASK_FILE`:

```bash
my-agent --task-file "$ANYSPACE_TASK_FILE"
```

`$ANYSPACE_TASK_FILE` is set automatically by AnySpace on every Run, pointing at the same file `{task_file}` substitutes — use whichever style fits your agent.

## Run Task

Click **Run** on a card. AnySpace:

1. Writes the task body + system prompt to a temp file at `/tmp/anyspace-tasks/task-<uuid>.md`.
2. Substitutes `{task_file}` in the agent's command.
3. Either spawns a fresh tab with one terminal pane (default), or splits the current tab into a sibling pane (depending on how Run was triggered — see [Element picker](/docs/day-to-day/element-picker) for the in-tab variant).
4. After a 600ms delay (so the shell prompt is ready), types the command and presses Enter.

The card moves to **In Progress**. Move it to **In Review** or **Complete** by hand when done.

## Run from the element picker

In a Live Preview pane, the [element picker](/docs/day-to-day/element-picker) has a **Run now** action that bypasses the board: it captures an element, packages the screenshot + source location into a task file, and spawns the active agent in a sibling pane immediately. **Add to Kanban & run** does the same, but also creates a tracked card. Use the second one for any work you want to find again later.

## Stopping a run

There's no kill button — close the agent's pane, or send <kbd>Ctrl</kbd> + <kbd>C</kbd> in its terminal. The task card stays where you put it; AnySpace doesn't auto-track exit.

## Reference

| Field | Format |
|---|---|
| Task file path | `/tmp/anyspace-tasks/task-<uuid>.md` |
| Env var | `ANYSPACE_TASK_FILE` (always set) |
| Substitution | `{task_file}` in agent command |
| DB | `anyspace.db` (SQLite) |

## Related

- [Element picker](/docs/day-to-day/element-picker)
- [Team mode](/docs/team/team-mode)
- [Settings & data](/docs/reference/settings-data)
