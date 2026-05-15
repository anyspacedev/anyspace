"""POST /v1/chat/completions — OpenAI-shaped proxy gated by Clerk JWT.

Body shape mirrors OpenAI's chat.completions: `model`, `messages`, `tools?`,
`tool_choice?`, `stream?`. The client picks its model from MODEL_ALLOW_LIST
(see services/llm.py) — we resolve the alias and pipe to the upstream LLM
with a server-held key.

Streaming pass-through uses `StreamingResponse(media_type="text/event-stream")`
so the desktop side's existing SSE parser works unchanged.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import client_ip, current_user
from ..logging import log
from ..models.audit_log import AuditLog
from ..models.user import User
from ..services.llm import (
    LlmConfigError,
    LlmModelNotAllowedError,
    proxy_chat_oneshot,
    proxy_chat_stream,
    resolve_model,
)
from ..services.ratelimit import get_limiter
from ..services.usage_quota import check_or_raise as check_quota

router = APIRouter(prefix="/v1")


@router.post("/chat/completions")
async def chat_completions(
    request: Request,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    body: dict[str, Any] = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be a JSON object")
    if "model" not in body or not isinstance(body["model"], str):
        raise HTTPException(400, "missing or invalid 'model'")
    if "messages" not in body or not isinstance(body["messages"], list):
        raise HTTPException(400, "missing or invalid 'messages'")

    allowed, retry_after = get_limiter().check(f"u:{user.id}")
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"detail": "rate limited", "retry_after_sec": round(retry_after, 1)},
            headers={"Retry-After": str(int(retry_after) + 1)},
        )

    # Free-tier quota gate. Raises 402 with a structured body the desktop app
    # parses to surface the upgrade affordance. Skipped silently for Pro.
    check_quota(db, user, "ai")

    ip = client_ip(request)
    stream = bool(body.get("stream", False))

    # Validate model alias before we open a streaming response — a bad alias
    # should be a 400, not a stream that starts and then errors.
    try:
        resolve_model(body["model"])
    except LlmModelNotAllowedError as e:
        raise HTTPException(400, str(e)) from e

    try:
        if stream:
            db.add(AuditLog(
                ip=ip, path="/v1/chat/completions", status=200, user_id=user.id,
            ))
            db.commit()
            log.info("chat.stream", user_id=user.id, ip=ip, model=body.get("model"))
            return StreamingResponse(
                proxy_chat_stream(body),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        status, payload = await proxy_chat_oneshot(body)
        db.add(AuditLog(
            ip=ip, path="/v1/chat/completions", status=status, user_id=user.id,
        ))
        db.commit()
        log.info(
            "chat.oneshot", user_id=user.id, ip=ip, model=body.get("model"), status=status,
        )
        return JSONResponse(status_code=status, content=payload)
    except LlmModelNotAllowedError as e:
        raise HTTPException(400, str(e)) from e
    except LlmConfigError as e:
        raise HTTPException(503, str(e)) from e
