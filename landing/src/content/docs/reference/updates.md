---
title: Updates & release notes
description: How AnySpace updates itself, where to read what changed, and how to opt out.
section: reference
order: 50
updated: 2026-05-09
---

AnySpace ships frequent updates. By default, the app checks for new releases at launch and periodically while running. When one is available, you get a non-blocking notification with the option to install on next launch.

## How auto-update works

- On launch, AnySpace queries the update server with your current version.
- If a newer build exists, it downloads in the background.
- A toast appears: "Update available — restart to install."
- On the next launch, the new version replaces the old one.

The downloader uses its own HTTP client and bypasses the network proxy you configured in Settings. This is intentional so updates work even when the proxy itself is misbehaving.

## Where to read release notes

| Source | What you'll find |
|---|---|
| In-app **About** panel | Current version + changelog button |
| GitHub releases page | Full per-release notes, signed binaries |
| Status bar update toast | One-line summary |

## Skipping a release

When the update toast appears, click **Skip this version** to suppress the prompt for that specific release. AnySpace will still notify you when the next release lands.

## Opting out entirely

Settings → **About** → toggle **Check for updates** off. AnySpace will stop checking. You're then responsible for downloading new releases manually from the website or GitHub. Useful in environments where outbound checks are forbidden.

## Building from source

If you build from source you don't get the auto-updater. `git pull && cargo build` is your update path. See the project README for the source build instructions.

## Pre-release channels

There's no separate beta channel today. Pre-release builds are tagged on the GitHub releases page; download manually if you want to try them.

## Related

- [Privacy & data handling](/docs/reference/privacy)
- [Settings & data](/docs/reference/settings-data)
