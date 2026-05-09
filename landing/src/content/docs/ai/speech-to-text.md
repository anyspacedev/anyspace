---
title: Speech-to-text
description: Hold a hotkey, speak, release — AnySpace transcribes into the active pane.
section: ai
order: 50
updated: 2026-05-09
---

AnySpace has a hold-to-talk dictation system. You hold a hotkey, a floating bubble shows you're recording, and on release the audio is transcribed and injected into whichever surface you were using — terminal, editor, or AI chat. It's the fastest way to give context to an agent without typing it out.

## The hotkey

Defaults are platform-aware:

| Platform | Default hotkey |
|---|---|
| Linux / Windows | <kbd>Right Ctrl</kbd> |
| macOS | <kbd>Right Alt</kbd> (Apple keyboards have no Right Ctrl) |

Rebind in **Settings → Speech-to-text → Hotkey**. Pick any key combination; AnySpace records the binding via a key-listener so any non-conflicting combo works.

## Holding to record

1. Hold the hotkey. A floating bubble appears (draggable to reposition, persists across sessions).
2. Speak. The bubble shows a level meter and elapsed time.
3. Release. The audio uploads, transcribes, and injects.

Limits: minimum 350ms, maximum 60s auto-stop. Anything shorter is ignored as an accidental tap.

## Where the text goes

AnySpace snapshots the active surface when you release the hotkey:

- **Terminal pane** focused → bytes are written into the PTY (no trailing newline — review and Enter to run).
- **Monaco Editor pane** focused → text is inserted at the cursor or selection via Monaco's edit API. Undo/redo work normally.
- **Super Agent rail or full-page input** focused → text is appended to the chat box.
- **Anything else focused, but Super Agent is open** → AnySpace falls back to the SA chat box.
- **Last resort** → text is copied to the clipboard with a toast.

In a multi-pane selection (Cmd-click), every selected terminal receives the dictation.

## Provider presets

Settings → Speech-to-text → Provider:

| Preset | Notes |
|---|---|
| **Groq Whisper** (default) | Free tier, fast. Set your Groq key. |
| **OpenAI Whisper** | Standard `audio/transcriptions` endpoint. |
| **ElevenLabs** | Their `speech-to-text` endpoint. |
| **AnySpace Cloud** | Bundled with your AnySpace account. Sign in once. |
| **Custom** | Any OpenAI-compatible `/audio/transcriptions` endpoint. |

The first time you save STT settings on a fresh install, AnySpace seeds the API key from your **AI** section's key, on the assumption you're using the same provider. Override if you want a separate STT key.

## Language

Defaults to **auto-detect** (Whisper-family models do this internally). Pin a specific language in Settings if you only ever dictate in one — the transcription is faster and slightly more accurate.

## In Team mode

If the focused pane is part of a Team:

- With **no explicit multi-pane selection**: dictation fans to every team-pane PTY by default — useful for "all agents, do X."
- With an **explicit selection**: only the selected panes receive input, just like a normal multi-pane broadcast.

This makes voice the most ergonomic way to direct a multi-agent room.

## What is sent

For each dictation:

- The recorded WAV blob is uploaded to your configured provider.
- No metadata about your project, panes, or other context is included.

If you want strict on-device transcription, point the Custom provider at a local Whisper server (e.g. [whisper.cpp's server](https://github.com/ggerganov/whisper.cpp/tree/master/examples/server) on `127.0.0.1`). Loopback is exempt from the network proxy. See [Privacy & data handling](/docs/reference/privacy).

## Microphone permission

- **macOS**: System Settings → Privacy & Security → Microphone → enable AnySpace.
- **Linux**: Most distros allow access by default. PulseAudio and PipeWire both work; ALSA-only systems may need `apulse`.
- **Windows**: Settings → Privacy → Microphone → enable AnySpace.

If recording fails silently, check permissions first.

## Reference

| Setting | Where |
|---|---|
| Hotkey | Settings → Speech-to-text |
| Provider preset / endpoint / model / key | Settings → Speech-to-text |
| Language | Settings → Speech-to-text |
| Bubble position | Drag the bubble — saved automatically |

## Related

- [Configure your AI provider](/docs/ai/configure-ai)
- [Super Agent](/docs/ai/super-agent)
- [Multi-pane selection & broadcast](/docs/day-to-day/broadcast)
- [Privacy & data handling](/docs/reference/privacy)
