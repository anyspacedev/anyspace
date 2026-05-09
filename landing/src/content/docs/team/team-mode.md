---
title: Team mode
description: Multi-agent workspaces where CLI agents collaborate via shared markdown files.
section: team
order: 20
updated: 2026-05-09
---

Team mode is AnySpace's multi-agent workspace. You define a roster of agents — each with a role, label, and CLI program — and AnySpace launches them as parallel panes in a single tab. The agents coordinate by reading and writing shared markdown files (`BOARD.md`, `MESSAGES.md`) inside your project folder. There is no central server; all coordination is on disk.

## Creating a team

In the title bar, next to **New tab**, click the **Team** picker (or press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd>). Fill in:

- **Goal** — one sentence describing what the team should accomplish.
- **Project folder** — where coordination files will live.
- **Roster** — one row per agent: role, label, AI program (which Kanban Agent definition to use).
- **Skills** — checkboxes for capabilities the team should have (e.g. "playwright", "git operations"). Built-in skills are general; you can define your own in Settings.
- **Attachments** (optional) — files or screenshots to seed into every agent's prompt.

Hit **Launch**.

## Roles

Built-in roles:

| Role | Purpose |
|---|---|
| Coordinator | Plans, tracks status, talks to other agents and the operator. Usually the first to read MESSAGES.md and update BOARD.md. |
| Builder | Implements code changes. Most of the actual work. |
| Scout | Investigates, gathers context, reads logs. |
| Reviewer | Code review, tests, regression checks. |

You can also define **custom roles** in **Settings → Multi-agent teams**. Each role has a label, optional accent color, and a body that gets baked into the agent's prompt file.

## What gets created on disk

Inside your project folder, AnySpace creates `.anyspace/teams/<teamId>/`:

```
.anyspace/teams/<teamId>/
├── BOARD.md             # roster + tasks + status (agents edit this)
├── MESSAGES.md          # append-only inter-agent log
├── .prompts/
│   ├── coordinator.md   # per-agent: role + goal + skills bundle
│   ├── builder.md
│   └── ...
├── .rpc/                # request/response files for tmsg pane RPC
└── .consumed/           # per-agent ledger of acknowledged messages
```

The whole `.anyspace/` directory is gitignored by default in this template, but the files are intentionally inside your working tree so agents can read them with their normal file tools.

## Per-agent prompts

When AnySpace launches an agent, the agent's CLI receives `.prompts/<labelSlug>.md` as its task input. The file contains:

- The team goal.
- The agent's role description.
- The selected skills.
- Any attachments.
- A reminder of how to use `tmsg` for inter-agent messaging.

If you change roles or skills between launches (in Settings), the prompt files are re-rendered the next time the team resumes.

## Templates

In the Team picker, click **Templates** to save or apply a preset roster. A template snapshots `{ name, goalSeed, roster, skillIds }`. Useful when you run the same shape of team repeatedly (e.g. a "feature build" trio of Coordinator + Builder + Reviewer).

## AI-assisted decomposition

The picker has a **decompose** button next to the Goal field. Type your goal, click it, and AnySpace asks your AI provider to suggest a roster, skills, and team name based on the goal. You can edit the result before launching. Useful when you don't know what the right team shape is yet.

## Inter-agent messaging

Agents talk to each other via the `tmsg` shell function — a small Bash function AnySpace injects into team panes. See [Operator inbox & tmsg](/docs/team/operator-tmsg) for the full reference, including how `@operator` escalations bubble up to you.

## Resuming after restart

Active teams are persisted in SQLite. When you next launch AnySpace:

1. The workspace re-hydrates, including the team's tab.
2. Each agent's prompt is re-rendered (so role/skill changes between sessions take effect).
3. The launch command is re-derived and re-injected into the panes after a short delay so the shell prompt is ready.

If a team's tab was closed, the team is auto-archived. Reactivate from **Teams** in the sidebar — AnySpace clears stale pane IDs and launches fresh.

## Voice into a team

Hold the speech-to-text hotkey while focused on a team-pane terminal:

- With no explicit multi-pane selection, your dictation **fans to every team-pane PTY** automatically — natural for "all of you, please do X."
- With an explicit selection, only those panes receive input.

In both cases, no auto-newline. You press Enter to broadcast.

## Closing & archiving

- Closing a team's tab archives the team automatically. Watchers stop. The disk files stay.
- Reactivate from **Teams** in the sidebar.
- Permanently delete via **Teams → Delete** (does not remove the on-disk `.anyspace/` directory — you can clean that up by hand if you want).

## Reference

| Path | Purpose |
|---|---|
| `.anyspace/teams/<id>/BOARD.md` | Roster, tasks, status |
| `.anyspace/teams/<id>/MESSAGES.md` | Inter-agent message log |
| `.anyspace/teams/<id>/.prompts/<label>.md` | Per-agent prompt file |
| `.anyspace/teams/<id>/.rpc/` | RPC request/response files |
| `.anyspace/teams/<id>/.consumed/<label>.txt` | Acknowledged-message ledger |

## Related

- [Operator inbox & tmsg](/docs/team/operator-tmsg)
- [Kanban & Run Task](/docs/team/kanban-run-task)
- [Speech-to-text](/docs/ai/speech-to-text)
- [Super Agent](/docs/ai/super-agent)
