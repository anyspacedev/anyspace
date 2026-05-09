---
title: Configure your AI provider
description: Connect AnySpace to an OpenAI-compatible chat endpoint — keys, models, and proxy notes.
section: ai
order: 10
updated: 2026-05-09
---

AnySpace is provider-agnostic. It talks to any OpenAI-compatible `/chat/completions` endpoint — OpenAI itself, Groq, Together, OpenRouter, your local LLM gateway, or AnySpace Cloud. You configure one provider in **Settings → AI**, and that powers Super Brain (⌘⇧B), the **Explain** action on command blocks, and (by default) Super Agent.

## Where to set it

Open Settings → **AI**:

| Field | Notes |
|---|---|
| Endpoint | Full URL ending in `/chat/completions`, e.g. `https://api.openai.com/v1/chat/completions` |
| API key | Plaintext, stored in `settings.json` (see below) |
| Model | Provider-specific name, e.g. `gpt-4o`, `llama-3.3-70b-versatile` |
| System prompt | Default system prompt used for ad-hoc actions like "Explain block" |

After saving, click **Test** to verify with a 1-token request.

## OpenAI-compatible providers

Any provider that exposes the OpenAI Chat Completions shape works without further config. Common ones:

| Provider | Endpoint |
|---|---|
| OpenAI | `https://api.openai.com/v1/chat/completions` |
| Groq | `https://api.groq.com/openai/v1/chat/completions` |
| Together | `https://api.together.xyz/v1/chat/completions` |
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` |
| Local (e.g. llama.cpp, vLLM, LM Studio) | `http://127.0.0.1:8080/v1/chat/completions` |

## Anthropic models — use OpenRouter

AnySpace's tool-calling format follows OpenAI's shape (`tool_calls[]` and `tool` role replies keyed by `tool_call_id`). Most OpenAI-compat shims accept this verbatim. Anthropic's native API at `api.anthropic.com/v1/messages` does **not** — it uses a different envelope.

To use Claude via Super Agent, point your endpoint at OpenRouter (or any other OpenAI-compat shim that proxies Anthropic models):

```
https://openrouter.ai/api/v1/chat/completions
```

…then set the model to e.g. `anthropic/claude-sonnet-4-6`. Tool calling will work.

## AnySpace Cloud

AnySpace Cloud is a managed endpoint we host. Sign in once via Settings → AI → **Sign in with AnySpace**; the same login also gates the Speech-to-text "AnySpace Cloud" preset. Cloud usage is billed per request.

## Network proxy

Every outbound request from AnySpace's AI commands goes through the centralized proxy helper. Configure it in **Settings → Network proxy**: HTTP/HTTPS or SOCKS5, plus an optional `NoProxy` list. Loopback addresses (`localhost`, `127.0.0.1`, `::1`) are always added to `NoProxy` automatically, so a local LLM endpoint will reach you even when a proxy is configured.

What is **not** routed through the proxy:

- The Live Preview iframe (it talks to localhost dev servers directly).
- The auto-updater.
- Shell processes spawned by terminals (they inherit your environment).

## Where keys are stored

Keys live in plaintext in your AnySpace `settings.json`:

| OS | Path |
|---|---|
| macOS | `~/Library/Application Support/AnySpace/settings.json` |
| Linux | `~/.config/AnySpace/settings.json` |
| Windows | `%AppData%\AnySpace\settings.json` |

If you don't want a long-lived plaintext key on disk, use a short-lived API key, scoped to chat completions only, and rotate when you're done.

## Using different keys for Super Agent

If you want Super Agent to use a different provider or model than the rest of the AI features, override per-section in **Settings → Super Agent**. Leave Super Agent's endpoint/key/model fields blank to inherit from the AI section. See [Super Agent](/docs/ai/super-agent).

## Reference

| Setting key | Where used |
|---|---|
| `ai.endpoint` / `ai.apiKey` / `ai.model` | Explain blocks, Super Brain |
| `superAgent.endpoint` (etc.) | Super Agent (falls back to `ai.*` if blank) |
| `stt.apiKey` | Speech-to-text (seeded from `ai.apiKey` on first run) |

## Related

- [Super Agent](/docs/ai/super-agent)
- [Super Brain](/docs/ai/super-brain)
- [Explain a command block](/docs/ai/explain-blocks)
- [Speech-to-text](/docs/ai/speech-to-text)
- [Privacy & data handling](/docs/reference/privacy)
