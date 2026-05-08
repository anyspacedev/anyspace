"""Chat completions proxy tests.

The route needs auth (Clerk JWT), validates the model alias, and either
proxies one-shot JSON or streams SSE bytes through. We monkeypatch the
LLM service so tests don't hit a real upstream.
"""

from __future__ import annotations

import pytest


def _body(model: str = "teamship-default", **extra) -> dict:
    return {
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        **extra,
    }


def test_anonymous_chat_returns_401(client):
    r = client.post("/v1/chat/completions", json=_body())
    assert r.status_code == 401, r.text
    assert "missing bearer token" in r.json()["detail"]


def test_invalid_jwt_returns_401(client_anon, auth_headers):
    r = client_anon.post(
        "/v1/chat/completions",
        json=_body(),
        headers=auth_headers,
    )
    assert r.status_code == 401


def test_unknown_model_rejected(client, auth_headers):
    r = client.post(
        "/v1/chat/completions",
        json=_body(model="not-a-real-model"),
        headers=auth_headers,
    )
    assert r.status_code == 400
    assert "allow-list" in r.json()["detail"]


def test_oneshot_proxies_to_upstream(client, auth_headers, monkeypatch):
    captured: dict = {}

    async def fake_oneshot(body):
        captured.update(body)
        return 200, {"choices": [{"message": {"content": "ok"}}]}

    from app.services import llm
    from app.routers import chat as chat_router
    monkeypatch.setattr(llm, "proxy_chat_oneshot", fake_oneshot)
    monkeypatch.setattr(chat_router, "proxy_chat_oneshot", fake_oneshot)

    r = client.post(
        "/v1/chat/completions",
        json=_body(stream=False),
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.json()["choices"][0]["message"]["content"] == "ok"
    # The router validates the alias, then forwards the body verbatim to
    # the (here-patched) proxy. Our fake captures whatever body the router
    # passed in — model untouched since the real resolve_model only runs
    # inside proxy_chat_oneshot, which we replaced.
    assert captured["model"] == "teamship-default"


def test_streaming_passthrough(client, auth_headers, monkeypatch):
    chunks = [
        b'data: {"choices":[{"delta":{"content":"hi"}}]}\n\n',
        b"data: [DONE]\n\n",
    ]

    async def fake_stream(body):
        for c in chunks:
            yield c

    from app.services import llm
    from app.routers import chat as chat_router
    monkeypatch.setattr(llm, "proxy_chat_stream", fake_stream)
    monkeypatch.setattr(chat_router, "proxy_chat_stream", fake_stream)

    r = client.post(
        "/v1/chat/completions",
        json=_body(stream=True),
        headers=auth_headers,
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/event-stream")
    body = r.content
    assert b"[DONE]" in body
    assert b'"hi"' in body
