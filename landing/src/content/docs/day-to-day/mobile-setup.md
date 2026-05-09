---
title: Setting up mobile preview
description: Install adb, scrcpy, and the iOS Simulator dependencies needed by the Mobile pane.
section: day-to-day
order: 60
updated: 2026-05-09
---

The Mobile pane mirrors a real Android device or an iOS Simulator into the workspace. AnySpace doesn't bundle the underlying tooling — `adb` and `scrcpy` for Android, Xcode + the Simulator for iOS — so you'll need to install them yourself. This page walks through each.

> Heads up: the Mobile pane is currently a stage-1 skeleton. Mirroring works; advanced features (input forwarding, gesture recording) are still being built.

## Android — install `adb` and `scrcpy`

You need both:

- **`adb`** (Android Debug Bridge): part of Android Platform Tools. Lists devices and proxies USB debugging.
- **`scrcpy`**: the screen-mirroring engine. Tiny, MIT-licensed, no Google account needed.

### macOS

```bash
brew install android-platform-tools scrcpy
```

### Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install android-tools-adb scrcpy
```

For older distros where `apt` ships an outdated `scrcpy`, [build from source](https://github.com/Genymobile/scrcpy/blob/master/doc/linux.md) or use the snap (`sudo snap install scrcpy`).

### Linux (Arch)

```bash
sudo pacman -S android-tools scrcpy
```

### Windows

AnySpace runs inside WSL on Windows, but `scrcpy` typically needs USB device access that WSL2 doesn't expose by default. Two workable paths:

1. **Native Windows install** (recommended): download `scrcpy` for Windows from [the GitHub releases](https://github.com/Genymobile/scrcpy/releases), unzip, and add the folder to `PATH`. Install [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools) similarly.
2. **WSL with USB forwarding** ([usbipd-win](https://github.com/dorssel/usbipd-win)): more setup, but keeps everything inside WSL.

AnySpace's Mobile pane prefers `adb.exe` and `scrcpy.exe` on Windows, so the native-Windows install just works.

## Android — enable USB debugging on the device

1. On the phone, open **Settings → About phone**, tap **Build number** seven times to unlock developer options.
2. Open **Settings → System → Developer options**, enable **USB debugging**.
3. Plug the phone into your computer with a USB cable.
4. Approve the **"Allow USB debugging?"** prompt on the phone.
5. Verify with `adb devices` — you should see your phone listed.

## iOS — Xcode + Simulator (macOS only)

iOS mirroring uses macOS's native ScreenCaptureKit; there's no scrcpy equivalent. Setup:

1. Install Xcode from the Mac App Store.
2. Open Xcode at least once and accept the license agreement.
3. Open **Xcode → Settings → Platforms** and download the iOS Simulator runtime for the iOS version you want.
4. Open Simulator manually once (Spotlight → "Simulator") to confirm it works.
5. Grant AnySpace **Screen Recording** permission in **System Settings → Privacy & Security → Screen Recording** when prompted.

iOS Mobile pane is hidden on Linux and Windows.

## Verify the install

Open AnySpace, change a pane's kind to **Mobile**, and pick the device chooser:

- **Android tab**: should list any plugged-in device by `adb` ID. Click to connect.
- **iOS tab** (macOS only): should list booted simulators. Click to connect.

If neither tab shows your device, see [Troubleshooting](/docs/reference/troubleshooting).

## Reference

| Tool | Source | Purpose |
|---|---|---|
| `adb` | Android Platform Tools | Device discovery + auth |
| `scrcpy` | https://github.com/Genymobile/scrcpy | Screen mirroring |
| Xcode + Simulator | Mac App Store | iOS device emulation |

## Related

- [Mobile pane](/docs/day-to-day/mobile-pane)
- [Troubleshooting](/docs/reference/troubleshooting)
