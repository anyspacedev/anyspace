---
title: Settings & data
description: Every Settings panel mapped, plus where AnySpace stores its data on each OS.
section: reference
order: 30
updated: 2026-05-09
---

AnySpace's settings live in plain JSON; its task data lives in SQLite; team coordination lives in markdown files inside your project. This page maps every Settings panel and points at the on-disk files for each.

## Settings panels

Open Settings from the sidebar. Search across all panels with the search box at the top.

| Panel | What's there |
|---|---|
| **Appearance** | Theme picker, color swatches |
| **Keyboard** | Hotkey rebinding for every shortcut |
| **Speech-to-text** | Provider preset, endpoint, key, model, language, hotkey, bubble position |
| **AI** | Provider endpoint, key, model, system prompt — used by Explain, Super Brain, and (by default) Super Agent |
| **Super Agent** | Optional overrides for endpoint/key/model, memory window, max tool calls per turn, streaming, per-tool enable/disable, vision flag, panel width |
| **Multi-agent teams** | Custom roles, custom skills, team templates |
| **Network proxy** | HTTP/HTTPS/SOCKS5 proxy + NoProxy exceptions |
| **Code Agent API** | Token management for AnySpace's local agent API |
| **About** | Version, build info, links |

## Settings file

All panel state is persisted to a single JSON file at the OS-appropriate config path:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/AnySpace/settings.json` |
| Linux | `~/.config/AnySpace/settings.json` |
| Windows | `%AppData%\AnySpace\settings.json` |

The file is plain text. Keys are stored under namespaces: `theme`, `ai`, `stt`, `superAgent`, `proxy`, `team`, `keybindings`, etc. You can hand-edit this file when AnySpace is **not running**; AnySpace overwrites it when you change a setting in the UI, so don't expect concurrent edits to merge.

## Data files

| Purpose | Path |
|---|---|
| Tasks (Kanban) and Agents | `<config-dir>/anyspace.db` (SQLite) |
| Team coordination | `<projectFolder>/.anyspace/teams/<teamId>/` |
| Super Agent sessions | `<config-dir>/anyspace.db` (same SQLite, separate tables) |
| Shell-integration script | `$TMPDIR/anyspace-shell-integration/integration.sh` |
| Task body files (transient) | `/tmp/anyspace-tasks/task-<uuid>.md` |
| Screenshot stack (session-only) | A temp dir cleaned on exit |

`<config-dir>` is the same directory as `settings.json` (see above).

## Migrations

AnySpace's SQLite schema evolves through numbered migrations (`001_*.sql`, `002_*.sql`, …). They run automatically on first launch after an update.

**Migrations are immutable once shipped.** If a future build needs to change your schema it'll add a new migration file; old ones never get edited. So your DB stays compatible across updates.

## Backing up

To migrate AnySpace settings + tasks to a new machine:

1. Quit AnySpace on the source machine.
2. Copy the entire config dir (the one containing `settings.json` and `anyspace.db`) to the new machine.
3. Launch AnySpace on the new machine.

Team coordination files (`.anyspace/teams/...`) live inside your project folders, so they migrate with your code.

## Resetting

To wipe AnySpace and start fresh:

1. Quit AnySpace.
2. Delete the config dir (paths above).
3. Relaunch — AnySpace recreates an empty `settings.json` and a fresh `anyspace.db`.

This does **not** touch any `.anyspace/` directories inside your project folders.

## Related

- [Privacy & data handling](/docs/reference/privacy)
- [Configure your AI provider](/docs/ai/configure-ai)
- [Themes](/docs/reference/themes)
- [Keyboard shortcuts](/docs/reference/shortcuts)
