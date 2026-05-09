---
title: Themes
description: AnySpace ships with five foundational themes — pick one in Settings.
section: reference
order: 10
updated: 2026-05-09
---

AnySpace ships with five foundational themes. Each one is a complete, coordinated set of colors that paint the workspace chrome, terminal output, and Monaco editor in matching tones. Switching is instant — no restart, no flash.

## The themes

| Theme | Kind | Notes |
|---|---|---|
| **Void** | Dark | Default. Near-black with cool greys; lowest visual weight. |
| **Dracula** | Dark | Classic purple/teal palette. Higher saturation than Void. |
| **Synthwave** | Dark | Magenta + cyan. Loud on purpose. |
| **Paper** | Light | Warm off-white with soft contrast. |
| **Solar** | Light/dark hybrid | Solarized-style — readable in any lighting. |

## How to switch

Open **Settings → Appearance → Theme** and click a swatch. The change applies immediately. You can also click the moon/sun icon in the title bar to toggle between dark and light variants of your current theme.

## What each theme touches

A theme is one bundle that paints three surfaces:

1. **UI tokens** — sidebar, tabs, Settings panels, kanban cards. Driven by CSS custom properties.
2. **xterm.js theme** — terminal foreground/background, ANSI palette, cursor color, selection highlight.
3. **Monaco theme** — derived from the same UI tokens, so the editor never clashes with the rest of the app.

You don't pick three separate themes — one selection covers all three.

## Custom themes

Themes are pure data: each one is an entry in AnySpace's `definitions.ts` containing palette + xterm + Monaco-derived tokens. We don't expose a UI for user themes today, but if you build from source you can add a sixth entry in a single file.

If you want this exposed in the app, [open a request](https://github.com/anyspacedev/anyspace/issues).

## Reference

| Setting | Where |
|---|---|
| Theme picker | Settings → Appearance |
| Quick toggle | Title bar moon/sun button |
| Storage key | `theme` in `settings.json` |

## Related

- [Settings & data](/docs/reference/settings-data)
- [Editor](/docs/day-to-day/editor)
