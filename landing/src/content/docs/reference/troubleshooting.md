---
title: Troubleshooting
description: Fixes for the most common issues — WSL, command blocks, preview, networking, and more.
section: reference
order: 70
updated: 2026-05-09
---

If something isn't working, check this list first. Issues are grouped by what surface they affect.

## Terminals & command blocks

### "WSL is required on Windows"

**Symptom**: A red overlay in the terminal pane that says WSL is required, with a link to Microsoft's install docs.

**Why**: AnySpace's terminal features rely on Bash/Zsh OSC 133 shell-integration. PowerShell and `cmd.exe` can't source it, so AnySpace looks for `wsl.exe` and refuses to fall back to a degraded shell.

**Fix**: Install WSL.

```powershell
wsl --install
```

Reboot if prompted. Open the Ubuntu (or whichever distro you picked) at least once to finish setup. Restart AnySpace.

### Command blocks not appearing — WSL `automount` disabled

**Symptom**: Terminals work, but no command blocks render. <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>[</kbd> / <kbd>]</kbd> don't navigate anywhere.

**Why**: AnySpace writes its shell-integration script to a Windows temp path and tells WSL to source it via a `/mnt/c/...` translation. If your WSL distro has `automount` disabled in `/etc/wsl.conf`, the `/mnt/c` path doesn't exist.

**Fix**: Inside WSL, edit `/etc/wsl.conf`:

```ini
[automount]
enabled = true
```

Then on Windows:

```powershell
wsl --shutdown
```

Reopen AnySpace. Blocks should render.

### Command blocks not appearing — non-bash/zsh shell

**Symptom**: As above, but on macOS or Linux.

**Why**: Your default shell is fish, nushell, or another non-Bash/Zsh shell. AnySpace's integration script only supports bash and zsh.

**Fix**: Either change the default shell to bash/zsh, or accept that blocks won't render in this shell. Terminals still work normally.

### "Failed to open icon" on first build (developers only)

**Symptom**: `cargo check` panics with this error when building from source.

**Why**: `tauri::generate_context!()` reads `src-tauri/icons/*` at compile time.

**Fix**: Make sure `src-tauri/icons/` contains the placeholder PNGs from the repo. Don't delete them.

## Live preview

### Blank page in the preview

**Symptom**: Preview pane is blank and the page never loads.

**Why**: Your dev server is sending `X-Frame-Options: DENY` (or `SAMEORIGIN`) or a restrictive `Content-Security-Policy: frame-ancestors`, which blocks iframe embedding.

**Fix**: In your dev server config, drop or relax those headers in development. AnySpace's Preview is an iframe; production sites that block embedding can't be previewed.

### Preview shows wrong port

**Symptom**: Preview detected your framework but loaded the wrong port.

**Why**: Auto-detection probes a priority list per framework. If your dev server uses a non-default port, the probe missed it.

**Fix**: Click the URL in the Preview header, change the port, press Enter.

## AI

### Super Agent fails on Anthropic models

**Symptom**: You configured the endpoint as `https://api.anthropic.com/v1/messages` and Super Agent errors out with "unexpected request shape" or similar.

**Why**: AnySpace emits OpenAI-style tool calls. Anthropic's native API uses a different shape.

**Fix**: Use OpenRouter or another OpenAI-compat shim that proxies Claude. Set the endpoint to `https://openrouter.ai/api/v1/chat/completions` and a model like `anthropic/claude-sonnet-4-6`. See [Configure your AI provider](/docs/ai/configure-ai).

### "AI provider not configured" on Super Brain

**Symptom**: Pressing <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd> shows a clear error.

**Fix**: Settings → AI → fill endpoint, key, model. Click Test. See [Configure your AI provider](/docs/ai/configure-ai).

### Super Agent tool call appears as "disabled"

**Symptom**: The model tried to call a tool, but the inline card shows "disabled."

**Why**: That tool is turned off in Settings → Super Agent → Tools. Disabled tools are also stripped from the model's tool list, but a stale conversation may still attempt a call.

**Fix**: Turn the tool back on in Settings, or re-prompt the agent without referencing that tool.

## Networking

### Proxy doesn't apply to the preview iframe

**Symptom**: You set an HTTP proxy in Settings, but the Preview iframe still hits localhost directly.

**Why**: This is intentional. Preview talks to local dev servers; loopback is always exempt.

**Fix**: No fix needed — the proxy correctly applies to AI/STT requests. Preview shouldn't be proxied.

### Proxy doesn't apply to shell processes

**Symptom**: Curl or wget inside a terminal pane ignore your AnySpace proxy.

**Why**: Shell processes inherit your OS environment. AnySpace doesn't inject proxy env vars into spawned shells.

**Fix**: Set `HTTPS_PROXY`/`HTTP_PROXY` in your shell config (`.bashrc`, `.zshrc`) — that's what tools in the shell will read.

### Proxy doesn't apply to the auto-updater

**Symptom**: Updater works even when your AnySpace proxy is broken.

**Why**: The updater uses Tauri's bundled HTTP client, separate from AnySpace's proxy-aware client. Intentional, so updates can recover.

**Fix**: No fix; this is by design. If you must route the updater, opt out of auto-update and download manually.

## Performance

### "Out of WebGL contexts" / corrupted terminals

**Symptom**: Terminals past your sixth one render incorrectly or scroll oddly.

**Why**: Browsers cap active WebGL contexts (~16 on Chromium, ~8 on WebKit). AnySpace renders the first six terminals on WebGL and falls back to xterm's DOM renderer past that.

**Fix**: Already automatic — no action needed. If you have many terminals, expect the older ones to use the slightly slower DOM renderer.

### White screen on maximize (Linux Wayland)

**Symptom**: AnySpace shows a blank white window after maximizing on a fractional-scale Wayland session.

**Why**: WebKitGTK's DMABUF renderer has a known bug with fractional scaling.

**Fix**: AnySpace ships with the DMABUF renderer disabled by default on Linux. If you build from source and hit this, set `WEBKIT_DISABLE_DMABUF_RENDERER=1` in your environment before launching.

## Team mode

### `tmsg: command not found`

**Symptom**: Running `tmsg send ...` in a team pane errors.

**Why**: `tmsg` is a Bash function, not a binary. It's only sourced into shells AnySpace spawned with `ANYSPACE_TEAM_TMSG` set in env.

**Fix**: Make sure the pane is part of a team launched via the Team picker (not a regular terminal in the same tab). Reopen the team if needed.

### MESSAGES.md growing forever

**Symptom**: MESSAGES.md gets large.

**Why**: Compaction is supposed to run automatically, debounced 60 seconds per team. If it isn't, your team's `flock` may not be releasing.

**Fix**: Close the team's tab to stop the watchers, then reopen. If on Windows, ensure your WSL distro has `flock` and `uuidgen` (default on Ubuntu/Debian). The compaction is a no-op on Windows builds, but the in-WSL `tmsg.sh` handles it.

## Speech-to-text

### Mic level meter doesn't move

**Symptom**: Holding the hotkey shows the bubble but no audio is captured.

**Fix**: Check microphone permission for AnySpace in your OS settings:

- macOS: System Settings → Privacy & Security → Microphone
- Linux: `pavucontrol` to confirm AnySpace appears in input apps
- Windows: Settings → Privacy → Microphone

### "Hotkey conflicts with another binding"

**Fix**: Settings → Speech-to-text → Hotkey → record a new combination. Right Ctrl / Right Alt are usually free; <kbd>F-keys</kbd> are also good choices.

## Still stuck?

[Open an issue](https://github.com/anyspacedev/anyspace/issues) with: AnySpace version (Settings → About), your OS, the steps to reproduce, and any console output. The more concrete, the faster we can fix it.

## Related

- [Install](/docs/get-started/install)
- [Configure your AI provider](/docs/ai/configure-ai)
- [Privacy & data handling](/docs/reference/privacy)
