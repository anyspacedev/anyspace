---
title: Remotes (SSH)
description: Stored SSH connections that spawn remote terminal panes from the sidebar. Uses your system ssh binary — ~/.ssh/config, jump hosts, and ControlMaster work natively.
section: day-to-day
order: 25
updated: 2026-05-11
---

The **Remotes** view stores SSH connection records and turns them into terminal panes with one click. AnySpace doesn't ship its own SSH client — it shells out to the system `ssh` binary, so anything you already rely on in `~/.ssh/config` (host aliases, identity files, `ProxyJump`, `ControlMaster`, agent forwarding) keeps working.

## Opening Remotes

Click **Remotes** in the sidebar (between Knowledge and Agents, server icon). The view lists stored hosts and exposes **Add host** / Edit / Delete actions per row.

If you've never added a host, the empty state explains that AnySpace uses the local `ssh` binary, so `~/.ssh/config` is read automatically.

## Adding a host

Click **Add host** and fill the form:

| Field | Notes |
|---|---|
| Name | Display label — what shows in the pane header and tab title. |
| Host | Hostname or IP. Required. Can be an alias from `~/.ssh/config`. |
| User | Optional. If blank, `ssh` reads `User` from `~/.ssh/config`. |
| Port | Optional. Defaults to 22; omitted from the argv when default. Must be 1–65535. |
| Auth method | Segmented toggle: **SSH key** or **Password**. |
| Identity file | Key auth only. Path to a private key. Browse picker opens a file dialog. Blank means "use the agent / config default". |
| Password | Password auth only. Stored in the OS keychain — never in `settings.json`. |
| Jump host | Optional. Passed as `-J user@bastion`. |
| Default directory | Optional. `cd`s into this path after connect, then `exec $SHELL -il`. POSIX shells only. |

Host records live under the `"ssh"` settings key (plain JSON in `app_config_dir/settings.json`). Passwords are stored separately in the OS keychain (libsecret on Linux, Keychain on macOS, Credential Manager on Windows) keyed by the host's internal id.

## Connecting

**Connect** spawns a remote terminal pane:

- If the active tab has an active pane, the new SSH pane is **horizontally split** alongside it.
- Otherwise, AnySpace opens a fresh single-pane tab named after the host.

Under the hood, `ssh` runs as the PTY's **root process** — not as a child of your local shell. This means a connection drop or remote `exit` terminates the PTY cleanly instead of dropping you back to a local prompt mid-session.

The argv vector is built from the host record:

```
ssh [-i <identityFile>] [-p <port>] [-J <jumpHost>] [-o SetEnv=K=V …] <user@host> [-t "cd '<dir>' && exec $SHELL -il"]
```

`-o SetEnv` entries only take effect if the remote `sshd` whitelists the variable via `AcceptEnv` — otherwise they're silently dropped server-side.

## SSH pane chrome

An SSH pane looks like a normal terminal pane with two additions:

- **Server icon + `SSH` badge** in the header, replacing the usual terminal icon.
- **`user@host:port` subtitle** next to the host name (port omitted when 22).

Two things are deliberately **disabled** on SSH panes:

- **Command blocks.** The OSC 133 shell-integration hook lives in `$TMPDIR` on *your* machine. It isn't sourced by the remote shell, so there's no marker stream to wrap blocks around. You get a plain scrollback.
- **Super Brain (⌘⇧B).** The button is hidden from the pane header — Super Brain reads the latest command block, which doesn't exist here.

The rest of the workspace still works: split, swap, drag-to-rearrange, broadcast keystrokes, theme, and STT dictation all behave normally.

## Reconnect on exit

When `ssh` exits — clean disconnect, remote reboot, network drop, anything — the pane **does not close**. Instead, a reconnect overlay appears with the host name and two buttons:

- **Reconnect** — bumps an internal attempt counter, which remounts the Terminal component and spawns a fresh `ssh` process. The argv is **re-derived from the current host record**, so any edits you made between sessions take effect immediately.
- **Close pane** — drops the pane.

There's no auto-reconnect. A flaky link shouldn't silently retry — you decide when to come back.

Scrollback from the dead session is discarded on reconnect. The exited-overlay state is also stripped from the persisted snapshot, so restarting the app while a pane is in "exited" state gives you a fresh attempt.

## Password authentication

If you can't use key auth (legacy infrastructure, jump-box quirks, a server you don't fully control), password auth is available. The mechanism:

1. On save, the password goes into the OS keychain — never to `settings.json`.
2. On Connect, AnySpace reads the password back out and writes it to a **self-deleting `SSH_ASKPASS` script** in a temp directory.
3. `ssh` is spawned with `SSH_ASKPASS_REQUIRE=force` (OpenSSH 8.4+), so it calls the askpass helper instead of prompting on the TTY.
4. The script deletes itself after the first read, so the secret doesn't outlive the spawn.

Requires **OpenSSH 8.4 or newer** on the connecting machine — earlier versions ignore `SSH_ASKPASS_REQUIRE` and fall back to TTY prompts (which won't work with a programmatic helper).

### Editing a password host

Opening an existing password host shows `(unchanged)` as the password placeholder. Leaving it blank keeps the keychain entry as-is. Type a new password to replace it.

Switching a host from password → key auth clears the keychain entry. Deleting a host also clears its keychain entry. There's never a record claiming password auth without a matching keychain secret.

### Linux first-time keychain

On a fresh Debian / XFCE system (especially when you log in over SSH and PAM never captures your password), `gnome-keyring` may start with only an in-memory `session` collection and no default. The first save in that state calls `CreateCollection("Login", "default")` via dbus, which makes `gcr-prompter` ask you for a master password once. Subsequent saves are silent.

If the prompter doesn't appear, the host process is missing display env vars (`DISPLAY`, `XAUTHORITY`, `XDG_*`) in the session dbus activation environment — AnySpace propagates these at startup, but if you launched from an unusual context (a TTY, a remote SSH session into your own machine), `gcr-prompter` may still come back as "dismissed".

## Windows

Terminals run inside WSL on Windows (`cmd.exe` and PowerShell can't source the OSC 133 hook). SSH inherits this — `ssh` is invoked inside the distro via `wsl.exe -e`, so the Linux `ssh` binary inside WSL is what actually talks to the remote.

`WSLENV` forwards the relevant env vars across the Windows ↔ WSL boundary:

- Path-typed (`SSH_ASKPASS`) is translated to `/mnt/c/…` automatically.
- ID/URL-typed (`SSH_ASKPASS_REQUIRE`, `DISPLAY`) is passed verbatim.

Password auth therefore works on Windows as long as WSL's `ssh` is recent enough (Ubuntu 22.04+ ships OpenSSH 8.9, which is fine).

## Restart resume

On app boot, AnySpace:

1. Loads the host list from `"ssh"` settings.
2. For each restored pane carrying an `sshHostId`, **re-derives the spawn args from the live host record** — not from the snapshot. Edits between sessions propagate automatically (rename a host, change its port, swap auth — the next pane spawn picks it up).
3. Strips the dead-session and reconnect-counter state, so panes start clean.

If the host record was deleted while a pane referenced it, the reconnect overlay surfaces with a "host record missing — restore it from Settings → SSH or close this pane" message.

## Settings entry

**Settings → SSH hosts** is a small summary page: it shows the host count and an **Open Remotes** button. Caveats listed there match this doc — they exist so an operator searching Settings for "ssh" lands somewhere informative.

The full add/edit/delete UI is in Remotes, not Settings.

## Gotchas

- **No command blocks remotely.** This is fundamental — without the OSC 133 hook on the remote side, AnySpace has no command-boundary markers. The remote shell still works; the chrome around it doesn't apply.
- **ControlMaster is shared.** If your `~/.ssh/config` sets a fixed `ControlPath`, AnySpace's SSH panes multiplex with any other `ssh` session on the same machine — including one you started from a terminal outside AnySpace. Killing the control master closes every session sharing it.
- **`SetEnv` needs server cooperation.** Per-host env entries are emitted as `-o SetEnv=K=V` flags. The remote `sshd` must whitelist each `K` under `AcceptEnv` for them to land in the remote shell.
- **No agent forwarding flag.** AnySpace doesn't expose `-A` in the form. If you need it, set `ForwardAgent yes` in `~/.ssh/config` for the host — AnySpace inherits that config naturally.
- **Default directory needs a POSIX shell.** The `cd '<dir>' && exec $SHELL -il` trick assumes a Unix-like remote shell. It won't do anything useful against a Windows OpenSSH server running `cmd.exe`.

## Related

- [Terminal & command blocks](/docs/day-to-day/terminal-blocks)
- [Multi-pane selection & broadcast](/docs/day-to-day/broadcast)
- [Pane kinds](/docs/workspace/pane-kinds)
- [Troubleshooting](/docs/reference/troubleshooting)
