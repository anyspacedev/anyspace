"""Thin proxy to an upstream OpenAI-compatible /chat/completions endpoint.

The desktop client speaks OpenAI dialect; we don't transform the request
shape. We do:
  1. Resolve the requested model alias via `MODEL_ALLOW_LIST`. Aliases let
     us decouple the client-facing name ("anyspace-default") from the
     upstream model ("gpt-4o-mini") so we can swap providers without a
     client release.
  2. Forward the body with the server-held key. SSE bytes pass through
     unchanged so the Tauri side's existing parser keeps working.

A Phase-2 enhancement would split per-user model permissions and per-request
token accounting; for now the route is a flat-rate cloud convenience.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Any

import httpx

from ..settings import get_settings


class LlmConfigError(RuntimeError):
    """Raised when the upstream is not configured (operator misconfiguration)."""


class LlmModelNotAllowedError(ValueError):
    """Raised for an unknown/disallowed model alias from the client."""


# Client-facing alias → upstream model id. Keep `anyspace-default` first so
# clients that send it (as the new default model name) get a sensible target.
MODEL_ALLOW_LIST: dict[str, str] = {
    "anyspace-default": "",  # resolved at call time to settings.llm_default_model
    "gpt-4o-mini": "gpt-4o-mini",
    "gpt-4o": "gpt-4o",
    "claude-3-5-sonnet": "claude-3-5-sonnet-latest",
    "claude-3-5-haiku": "claude-3-5-haiku-latest",
}


def resolve_model(client_model: str) -> str:
    """Map the alias to an upstream model id. Raises if unknown."""
    if client_model not in MODEL_ALLOW_LIST:
        raise LlmModelNotAllowedError(
            f"model {client_model!r} is not in the allow-list",
        )
    upstream = MODEL_ALLOW_LIST[client_model]
    if not upstream:  # "anyspace-default" sentinel
        return get_settings().llm_default_model
    return upstream


def _ensure_configured() -> tuple[str, str]:
    settings = get_settings()
    if not settings.llm_upstream_base or not settings.llm_upstream_key:
        raise LlmConfigError(
            "llm upstream is not configured (LLM_UPSTREAM_BASE / LLM_UPSTREAM_KEY)",
        )
    return settings.llm_upstream_base.rstrip("/"), settings.llm_upstream_key


async def proxy_chat_oneshot(body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    """Non-streaming branch — return upstream's JSON verbatim."""
    # Resolve model first so a bad alias surfaces as 400, not 503, even when
    # the upstream isn't configured (e.g. in tests).
    upstream_model = resolve_model(body.get("model", ""))
    base, key = _ensure_configured()
    body = {**body, "model": upstream_model, "stream": False}
    timeout = httpx.Timeout(get_settings().llm_request_timeout_sec)
    async with httpx.AsyncClient(timeout=timeout) as client:
        r = await client.post(
            f"{base}/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
            },
            json=body,
        )
    return r.status_code, r.json()


async def proxy_chat_stream(body: dict[str, Any]) -> AsyncIterator[bytes]:
    """Streaming branch — yield raw SSE bytes from the upstream.

    The client's `ai_chat_stream` Rust parser reads `data: {…}\\n\\n` lines and
    treats the upstream's `[DONE]` sentinel as end-of-stream. We do not buffer
    or translate; just pipe.
    """
    upstream_model = resolve_model(body.get("model", ""))
    base, key = _ensure_configured()
    body = {**body, "model": upstream_model, "stream": True}
    timeout = httpx.Timeout(get_settings().llm_request_timeout_sec)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream(
            "POST",
            f"{base}/chat/completions",
            headers={
                "Authorization": f"Bearer {key}",
                "Content-Type": "application/json",
                "Accept": "text/event-stream",
            },
            json=body,
        ) as r:
            if r.status_code >= 400:
                # Surface upstream errors as a single SSE error event so the
                # client's stream parser handles them through its normal path.
                detail = (await r.aread()).decode("utf-8", errors="replace")
                yield (
                    f"data: {{\"error\":{{\"status\":{r.status_code},"
                    f"\"detail\":{detail!r}}}}}\n\n".encode()
                )
                yield b"data: [DONE]\n\n"
                return
            async for chunk in r.aiter_raw():
                if chunk:
                    yield chunk
