---
title: Explain a command block
description: Send a command and its output to the AI for a one-shot explanation.
section: ai
order: 30
updated: 2026-05-09
---

The **Explain** action on a command block sends the command + its captured output to your AI provider and returns a short explanation. It's intentionally separate from Super Agent — there's no conversation, no tools, and no history. You ask, you read, you move on.

## Triggering Explain

Hover any finished command block. In the action row, click the sparkles icon. AnySpace opens an inline panel below the block and streams the explanation in.

The block must be finished (i.e., the OSC 133 D end-of-output marker has fired). Running blocks don't expose Explain.

## What gets sent

For one Explain request, AnySpace sends to your configured AI endpoint:

- Your system prompt from **Settings → AI**.
- The command line.
- The captured output (truncated if very long).
- The exit code and duration.

It does **not** send your full scrollback, other blocks, or any other panes' state.

## Tuning the response

Edit the system prompt in **Settings → AI**. Same prompt as Super Brain — be aware that changes affect both. Examples:

- "Be terse. Three sentences max."
- "Explain the command flag-by-flag, then summarize the output."
- "Highlight any security concerns first."

## What it does not do

- Does not run any commands itself.
- Does not call tools (use Super Agent for that).
- Does not remember prior Explain calls.
- Does not save the explanation anywhere — close the panel and it's gone.

If you want the explanation persisted, copy it out and paste into your notes.

## Cost

Each Explain is one round-trip to your provider — typically a few hundred input tokens and a few hundred output tokens. If you're on a metered plan, click Explain only when you actually need it.

## Reference

| Action | Where |
|---|---|
| Trigger Explain | Sparkles icon in block action row |
| Configure model + prompt | Settings → AI |

## Related

- [Terminal & command blocks](/docs/day-to-day/terminal-blocks)
- [Super Brain](/docs/ai/super-brain)
- [Super Agent](/docs/ai/super-agent)
- [Configure your AI provider](/docs/ai/configure-ai)
