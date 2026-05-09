---
title: Mobile pane
description: Mirror an Android device or iOS Simulator into a workspace pane.
section: day-to-day
order: 70
updated: 2026-05-09
---

The Mobile pane mirrors a connected device's screen into the workspace, so you can develop and test mobile UIs without alt-tabbing between an emulator and your code. It pushes captured frames into the [screenshot stack](/docs/day-to-day/screenshot-stack), which lets you drag a frame onto a terminal to attach it as input for an AI agent.

## Connecting

Change a pane's kind to **Mobile**, then pick a device:

- **Android tab** — every device discovered by `adb` is listed. Click one to connect.
- **iOS tab** (macOS only) — every booted Simulator is listed.

If a tab is empty and you expected a device, double-check [Setting up mobile preview](/docs/day-to-day/mobile-setup).

## What works today

This pane is a **stage-1 skeleton**. The pieces you can rely on:

- Live screen mirroring at 30 FPS.
- Frame capture into the screenshot stack.
- Basic device controls (Home, Back, Recents on Android).

What's not yet built:

- Reliable two-way input forwarding (taps and drags don't translate yet).
- Gesture recording / playback.
- Multi-device mirroring in one pane.

You can still tap and interact with the device directly through its physical screen; the mirror updates in real-time.

## Capturing a frame

Click the camera button in the pane header. The current frame is pushed onto the screenshot stack (lower-left of the workspace). From there you can drag it onto any terminal to attach the screenshot as a path the agent can read.

This is the primary integration with AI agents today: capture a screenshot of a bug or layout, drop it onto a Super Agent or Kanban-spawned terminal, and ask the AI to fix it.

## Disconnecting

Close the pane, or change its kind back to Terminal. The mirroring process stops automatically.

## Network & privacy

The mirror is a direct, local USB (Android) or local IPC (iOS Simulator) stream. No frames leave your machine via AnySpace itself. If you then drag a frame into a terminal handed to a cloud AI, the AI provider receives that file — that's between you and the provider you've configured. See [Privacy & data handling](/docs/reference/privacy).

## Reference

| Platform | Backing tool | macOS | Linux | Windows |
|---|---|---|---|---|
| Android | `scrcpy` + `adb` | ✅ | ✅ | ✅ (native install or WSL+usbipd) |
| iOS Simulator | ScreenCaptureKit | ✅ | ❌ | ❌ |

## Related

- [Setting up mobile preview](/docs/day-to-day/mobile-setup)
- [Screenshot stack](/docs/day-to-day/screenshot-stack)
- [Pane kinds](/docs/workspace/pane-kinds)
