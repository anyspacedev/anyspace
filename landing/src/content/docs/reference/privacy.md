---
title: Privacy & data handling
description: Where your keys, transcripts, and screenshots go — and what stays on your machine.
section: reference
order: 40
updated: 2026-05-09
---

AnySpace is local-first: settings, tasks, and team coordination files all live on your machine. The pieces that talk to the network are the AI and STT providers you explicitly configure, plus the auto-updater. This page lays out exactly what leaves the device, when, and where to look if you need to verify it.

## What stays local

- **Settings** — `settings.json` on disk. Never uploaded.
- **Kanban tasks and agent definitions** — `anyspace.db` (SQLite) on disk.
- **Super Agent sessions** — same SQLite DB. Conversation history and tool-call results live alongside tasks.
- **Team coordination files** — `<projectFolder>/.anyspace/teams/<teamId>/` (BOARD.md, MESSAGES.md, .prompts, .rpc, .consumed). Inside your working tree, never uploaded by AnySpace.
- **Terminal scrollback** — held only in xterm.js memory. Cleared when the pane closes.
- **Screenshot stack** — temp files, cleaned on app exit.

## What leaves the machine, and when

Every outbound network call AnySpace makes itself is one of these:

### Your AI provider

Triggered by:

- **Explain a command block** — sends the command + output once.
- **Super Brain (⌘⇧B)** — sends the most recent finished block once.
- **Super Agent** — streams every turn. Includes: your messages, prior assistant messages and tool calls, the system prompt, and tool results that were returned this session. Memory window is configurable in Settings.

The endpoint is whatever you set in **Settings → AI** (or **Settings → Super Agent** override). If you don't set one, no AI request ever leaves.

### Your STT provider

Triggered when you hold the speech-to-text hotkey. The recorded WAV is uploaded to the configured `/audio/transcriptions` endpoint. No metadata about your panes or workspace is included.

### Auto-updater

AnySpace checks for new releases at app start (and periodically) by hitting the AnySpace update endpoint. Just version metadata; no telemetry payload.

You can opt out of auto-update; see [Updates & release notes](/docs/reference/updates).

### Crash reports

Disabled by default. There is no automatic crash-reporting upload. If you hit a bug we ask you to file an issue manually with the relevant context.

## What does **not** leave

- **The Live Preview iframe** is not routed through AnySpace's network proxy or any AnySpace endpoint. It fetches your dev server directly on loopback.
- **Mobile pane frames** stream over USB (Android) or local IPC (iOS Simulator). They never leave the device through AnySpace.
- **Shell processes spawned by terminals** inherit your environment — AnySpace doesn't intercept their network traffic.

## Where keys are stored

API keys are kept in plaintext in `settings.json`. If your threat model includes "anything readable on disk is compromised," use:

- A short-lived API key, scoped to chat completions only, rotated when you stop using it.
- A local LLM endpoint (loopback is exempt from the network proxy).

We don't currently use OS keychains for key storage; this is on the roadmap.

## On-device transcription

Point Speech-to-text → **Custom** at a local Whisper endpoint:

- [whisper.cpp's HTTP server](https://github.com/ggerganov/whisper.cpp/tree/master/examples/server)
- [Faster-Whisper](https://github.com/SYSTRAN/faster-whisper) with an OpenAI-compat shim

Your audio never leaves the machine. Same for AI — point your endpoint at a local llama.cpp / vLLM / LM Studio server.

## AnySpace Cloud

AnySpace Cloud is a managed endpoint. If you sign in, your AI and STT requests routed through AnySpace Cloud transit through our infrastructure. We log request metadata for billing and abuse prevention. Request payloads are not retained beyond what's needed to serve the request. The full policy lives at the AnySpace Cloud terms page.

If you don't want this, configure a different provider in Settings — AnySpace Cloud is opt-in.

## Operator escalations and team data

When agents in a team escalate to `@operator`, the resulting Super Agent system message contains the escalation text. That is sent to your AI provider on the next turn. Don't write secrets into MESSAGES.md if your provider's logging policy concerns you.

## Reference

| Path | Local |
|---|---|
| `settings.json` | Yes (plaintext) |
| `anyspace.db` | Yes (SQLite) |
| `.anyspace/teams/<id>/` | Yes (inside your project) |
| Outbound to your configured AI endpoint | Per-action |
| Outbound to your configured STT endpoint | Per-record |
| Outbound to AnySpace update server | App start + periodic |

## Related

- [Configure your AI provider](/docs/ai/configure-ai)
- [Speech-to-text](/docs/ai/speech-to-text)
- [Settings & data](/docs/reference/settings-data)
- [Updates & release notes](/docs/reference/updates)
