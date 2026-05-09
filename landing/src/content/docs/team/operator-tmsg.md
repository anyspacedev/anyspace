---
title: Operator inbox & tmsg
description: How team agents message each other and escalate to you, and the tmsg shell reference.
section: team
order: 30
updated: 2026-05-09
---

In Team mode, agents coordinate through two on-disk files (`BOARD.md` and `MESSAGES.md`) and a small shell function called **`tmsg`**. When an agent addresses a message to **`@operator`** or marks one as an **escalation**, you'll see a pill in the status bar — that's your inbox. Click it and AnySpace hands the unread context to Super Agent so you can respond fast.

## The status-bar inbox

When agents post messages addressed to `@operator` or with type `escalation`, AnySpace shows a pill in the bottom status bar:

```
● 3 @operator
```

Click it. AnySpace:

1. Opens the Super Agent rail (or focuses it if already open).
2. Ensures an active session.
3. Appends a single system bubble summarizing the unread escalations.
4. Clears the inbox.

You read, reply in the SA rail, and the agent reads your response from the next watcher tick. See [Super Agent](/docs/ai/super-agent).

The inbox dedupes: re-opening AnySpace after closing and re-opening shows new messages, not the entire history.

## `tmsg` — what it is

`tmsg` is a Bash function, not a binary. AnySpace injects it into team-pane shells via the same mechanism that handles OSC 133 shell integration. Agents call it from their CLI to message each other or read the board.

You can also use it manually from any team pane to peek at the room state.

## `tmsg send`

Append a message to `MESSAGES.md`.

```bash
tmsg send --to <Label|@all|@operator> [--type message|status|escalation|done] --body "..."
```

| Flag | Notes |
|---|---|
| `--to` | A specific agent label (e.g. `Builder`), `@all`, or `@operator` |
| `--type` | `message` (default), `status`, `escalation`, `done` |
| `--body` | The message text. Markdown is fine. |

Messages are appended as fenced markdown blocks with metadata (timestamp, from, to, type). The append is `flock`-protected so concurrent agents can't corrupt the file.

## `tmsg check`

Print messages addressed to me or `@all` that I haven't acknowledged yet.

```bash
tmsg check          # peek
tmsg check --consume   # peek AND mark as consumed
```

Each agent has its own `.consumed/<label>.txt` ledger of message IDs.

## `tmsg roster` and `tmsg board`

Convenience readers:

```bash
tmsg roster   # current team roster + each agent's pane ID
tmsg board    # current BOARD.md
```

## `tmsg pane`

RPC for manipulating panes. Agents can request a new sibling pane to run a focused task, then close it when done.

```bash
tmsg pane new --label <Label> --role <Role>   # split my pane, spawn sibling
tmsg pane close <pane_id>                      # close a pane
tmsg pane read <pane_id>                       # read the pane's terminal context
tmsg pane write <pane_id> --bytes "..."        # type into a pane (no auto-newline)
```

How it works: the agent writes a request file under `.anyspace/teams/<id>/.rpc/<uuid>.req`, AnySpace's watcher dispatches it to the workspace (e.g. `splitPane`, `closePane`, `getTerminalContext`), and writes a `.res` file the agent polls for.

## MESSAGES.md compaction

`MESSAGES.md` is append-only. To keep it from growing unbounded:

- AnySpace runs an automatic compaction triggered after every watcher refresh, debounced 60 seconds per team.
- Default: keep the most recent 250 entries; archive everything older to `MESSAGES.archive.md`.
- The compaction holds the same `.lock` `tmsg.sh` uses (atomic across processes).

You can read the archive any time; agents only see the compacted MESSAGES.md.

## What the operator typically does

- Watch the inbox pill.
- Click it to read escalations through Super Agent.
- Use Super Agent's `team_broadcast` and `team_send_to_pane` tools, or just type into selected team panes (Cmd-click) to direct the room.
- Move BOARD.md tasks around manually if agents are stuck.

## Platform note (Windows)

`tmsg.sh` is a Bash script that uses `flock` and `uuidgen`. On Windows, your team panes run inside WSL, where these are standard. There's nothing to install.

The Rust-side MESSAGES.md compaction is Unix-only — on Windows builds it's a no-op stub. Compaction still happens because `tmsg.sh` runs under WSL and uses `/usr/bin/flock` directly, so the lock is held inside the Linux side.

## Reference

| Subcommand | Purpose |
|---|---|
| `tmsg send` | Append a message |
| `tmsg check` | Read unconsumed messages addressed to me |
| `tmsg roster` | Show team roster |
| `tmsg board` | Show BOARD.md |
| `tmsg pane new` | Split my pane, spawn sibling agent |
| `tmsg pane close` | Close a pane |
| `tmsg pane read` | Read a pane's terminal context |
| `tmsg pane write` | Type into a pane |

## Related

- [Team mode](/docs/team/team-mode)
- [Super Agent](/docs/ai/super-agent)
- [Multi-pane selection & broadcast](/docs/day-to-day/broadcast)
