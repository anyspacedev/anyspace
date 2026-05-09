---
title: Live preview
description: Embed your local dev server as a pane, with auto-detect, device frames, and live reload.
section: day-to-day
order: 40
updated: 2026-05-09
---

The Preview pane embeds a live view of a local dev server inside the workspace. It auto-detects your framework, probes the right port, watches your project for changes, and lets you toggle between desktop and mobile device frames.

## Auto-detection

When you open a Preview pane, AnySpace reads the tab's project `package.json` and identifies the framework. It then probes a per-framework priority list of conventional ports until it finds a server.

| Framework | Default ports probed |
|---|---|
| Vite | 5173, 5174 |
| Next.js | 3000, 3001 |
| Astro | 4321, 4322 |
| SvelteKit | 5173, 4173 |
| Nuxt | 3000 |
| Remix | 3000 |
| Generic | 8080, 4200, 5000 |

If your dev server runs on a non-default port, click the URL bar in the Preview header and type it manually.

## Live reload

A file watcher with a 150ms debounce monitors your project folder. When files change (anywhere under the project root), the preview iframe reloads. You don't need to configure anything; the watcher starts when the Preview pane mounts and stops when it unmounts.

## Device frames

The Preview header has a device-frame switcher:

| Frame | Viewport |
|---|---|
| Desktop | 1280 × 800 |
| Tablet | 768 × 1024 |
| iPhone 15 | 393 × 852 |
| Fluid | Fills the pane |

Zoom from 50% to 200% with the slider next to the frame picker.

## What works, what doesn't

- ✅ Anything served from `http://localhost` or `http://127.0.0.1`.
- ✅ Anything that allows iframe embedding (no `X-Frame-Options: DENY` or restrictive `Content-Security-Policy: frame-ancestors`).
- ❌ Production sites that block iframe embedding (most of the public web).
- ❌ Sites that require a custom client cert or VPN that the iframe can't see.

If you load a URL and see a blank page, your server is probably setting `X-Frame-Options`. Either disable it in development, or open the URL in a real browser.

## Network proxy

Live Preview's iframe is **not** routed through AnySpace's HTTP proxy settings — it's an in-process WebView fetching loopback addresses. This is intentional: dev servers should always be reachable directly. See [Settings & data](/docs/reference/settings-data) for what *is* proxied.

## Element picker

Toggle the crosshair button in the Preview header to enable [the element picker](/docs/day-to-day/element-picker). Click any element in the preview, hand it to an AI agent, and ask for changes.

## Reference

| Setting | Where |
|---|---|
| Detected framework | Settings → Preview (auto-populated) |
| Watched port | Settings → Preview |
| Device frame | Preview pane header |
| Zoom | Preview pane header slider |

## Related

- [Element picker](/docs/day-to-day/element-picker)
- [Pane kinds](/docs/workspace/pane-kinds)
- [Troubleshooting](/docs/reference/troubleshooting)
