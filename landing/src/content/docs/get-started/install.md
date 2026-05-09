---
title: Install
description: Download AnySpace for macOS, Linux, or Windows, and check the system requirements.
section: get-started
order: 20
updated: 2026-05-09
---

AnySpace ships as a native desktop app for macOS, Linux, and Windows. Pick the build for your operating system on the [download page](/#download) and follow the per-OS notes below.

## System requirements

| Platform | Requirement |
|---|---|
| macOS | 12 Monterey or newer (Apple Silicon or Intel) |
| Linux | `glib >= 2.70` (Debian 12, Ubuntu 22.04, Fedora 36+) |
| Windows | Windows 10/11 with **WSL** installed |

If you build from source you also need Rust 1.77+ and Node 20+, but the released binaries don't.

## macOS

1. Download the `.dmg`.
2. Open it, drag **AnySpace** to `/Applications`.
3. First launch: macOS Gatekeeper may show "AnySpace cannot be opened because Apple cannot verify the developer." Right-click the app → **Open** → confirm. After that it launches normally.
4. Grant **Microphone** access the first time you use Speech-to-text.
5. Grant **Screen Recording** access if you plan to use the iOS Simulator pane.

## Linux

The `.deb` and `.AppImage` builds both work.

```bash
# Debian/Ubuntu
sudo apt install ./anyspace_*.deb

# AppImage (any distro)
chmod +x AnySpace-*.AppImage
./AnySpace-*.AppImage
```

If you see a blank white window after maximizing on a fractional-scale Wayland session, see [Troubleshooting](/docs/reference/troubleshooting#white-screen-on-maximize).

## Windows — WSL is required

AnySpace's command-block, AI suggestion, and multi-agent features depend on a Bash/Zsh-compatible shell. PowerShell and `cmd.exe` cannot source the shell-integration script, so AnySpace runs every terminal **inside WSL**.

1. Install WSL if you haven't:
   ```powershell
   wsl --install
   ```
   Reboot if prompted. Open the new Ubuntu (or whichever distro you picked) and finish first-time setup.
2. Install AnySpace from the `.msi` installer.
3. On first launch AnySpace will detect `wsl.exe` and spawn `wsl.exe -e bash -il` for every terminal pane.

If WSL isn't installed AnySpace will show a clear "WSL is required on Windows" overlay with a link to Microsoft's install docs. The rest of the app still works, but command blocks, Super Brain, and Team mode won't function until WSL is available.

> Heads-up: if your WSL distro has `automount` disabled in `/etc/wsl.conf`, the shell-integration hook silently no-ops. See [Troubleshooting](/docs/reference/troubleshooting#wsl-automount-disabled).

## First-launch checklist

After installing, before you start using AnySpace seriously:

1. **Pick your theme** — Settings → Appearance. There are five built-ins; you can switch any time.
2. **Configure an AI provider** — Settings → AI. Even if you don't plan to use Super Agent, the same keys power "Explain command block" and Super Brain. See [Configure your AI provider](/docs/ai/configure-ai).
3. **Set your speech-to-text hotkey** — Settings → Speech-to-text. Defaults are sensible (`Right Ctrl` on Linux/Windows, `Right Alt` on macOS), but rebind if it conflicts with anything.
4. **(Optional) Network proxy** — Settings → Network proxy if you're behind a corporate proxy. Local AI/STT endpoints always bypass it.

You're done. Head to the [Quick tour](/docs/get-started/quick-tour).
