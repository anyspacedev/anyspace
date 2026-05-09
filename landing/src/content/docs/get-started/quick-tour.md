---
title: Quick tour
description: Open a project, split a pane, run a command, see a block, and try the AI helpers — in three minutes.
section: get-started
order: 30
updated: 2026-05-09
---

This tour gets you from a fresh launch to using every major AnySpace feature once. It assumes you've finished [Install](/docs/get-started/install).

## 1. Open a project

Click **New tab** in the title bar (or press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>T</kbd>) → **Pick folder** and choose a code project. The tab is bound to that folder; every terminal, editor, and preview pane inside the tab opens against it.

## 2. Run a command, see a block

In the terminal pane, run something simple:

```bash
ls -la
```

Notice the result is wrapped in a **command block**: a thin border, a header showing the command, and footer actions on hover. Click **Rerun**, **Copy**, **Copy as Markdown**, or **Explain** to act on the block. Use <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>[</kbd> and <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>]</kbd> to step backward and forward through blocks.

## 3. Split into a 2-pane layout

Press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>D</kbd> to split horizontally, or <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>D</kbd> to split vertically. You now have two terminals side by side. Drag the divider to resize. Drag a pane header onto another pane to swap them.

## 4. Try Super Brain (⌘⇧B)

In one of the terminals, leave the prompt empty. Press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>B</kbd>. AnySpace looks at your recent command + output, asks the AI for the next likely command, and **types the suggestion into the prompt without running it**. Review, edit if you want, then press Enter to actually run.

If you haven't configured an AI provider yet, this will fail with a clear error — see [Configure your AI provider](/docs/ai/configure-ai).

## 5. Open Super Agent

Click the **AI** rail tab on the right edge of the workspace (or use the sidebar **Super Agent** entry for the full-page view). Type:

> List the files in this project and tell me what it does.

Super Agent streams a reply, calls a couple of tools (`gitStatus`, `listDir`), and shows the tool calls inline. You can disable individual tools or pause execution from the rail header. See [Super Agent](/docs/ai/super-agent).

## 6. Convert a panel to something else

Click the **kind** label in any pane header (e.g. "Terminal") → pick **Editor**, **Preview**, **Mobile**, or **Files**. The rest of the layout doesn't change. State for the old kind is discarded; you can switch back any time.

Open a **Preview** pane and AnySpace probes for a running dev server (Vite, Next, Astro, SvelteKit, Nuxt, Remix). If you have one running, it'll attach.

## 7. Try voice input

Hold <kbd>Right Ctrl</kbd> (Linux/Windows) or <kbd>Right Alt</kbd> (macOS). A floating bubble shows a recording indicator. Speak a command. Release. The transcribed text is typed into the active terminal **without** a newline — review and press Enter to run. See [Speech-to-text](/docs/ai/speech-to-text).

## What's next

You've now touched the major surfaces. Pick a deeper read:

- [Tabs, panes & layouts](/docs/workspace/tabs-panes-layouts) — layout templates, drag, swap.
- [Terminal & command blocks](/docs/day-to-day/terminal-blocks) — every block action explained.
- [Super Agent](/docs/ai/super-agent) — sessions, tools, vision.
- [Team mode](/docs/team/team-mode) — multi-agent collaboration.
