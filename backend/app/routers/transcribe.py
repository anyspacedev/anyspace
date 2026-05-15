"""POST /v1/audio/transcriptions — OpenAI-shaped Whisper-style endpoint.

Phase 1 has no auth; protection is per-IP token bucket + max audio length
+ max body size. Phase 2 gates this with a Bearer JWT and per-user limits.
"""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..db import get_db
from ..deps import client_ip, current_user
from ..logging import log
from ..models.audit_log import AuditLog
from ..models.user import User
from ..services.asr import LANG_MAP, transcribe_pcm
from ..services.audio import AudioDecodeError, decode_to_pcm
from ..services.ratelimit import get_limiter
from ..services.usage_quota import check_or_raise as check_quota
from ..settings import get_settings

router = APIRouter(prefix="/v1")


@router.post("/audio/transcriptions")
async def transcribe(
    request: Request,
    file: UploadFile = File(...),
    language: str | None = Form(default=None),
    model: str | None = Form(default=None),  # noqa: ARG001  (accepted for parity)
    response_format: str | None = Form(default="json"),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> JSONResponse:
    settings = get_settings()
    ip = client_ip(request)

    # Rate-limit key is per-user (anonymous case is gone — current_user 401s).
    # IP is logged for forensics.
    allowed, retry_after = get_limiter().check(f"u:{user.id}")
    if not allowed:
        return JSONResponse(
            status_code=429,
            content={"detail": "rate limited", "retry_after_sec": round(retry_after, 1)},
            headers={"Retry-After": str(int(retry_after) + 1)},
        )

    if response_format and response_format != "json":
        raise HTTPException(400, "only response_format=json is supported in phase 1")

    # Free-tier quota gate. Raises 402 with a structured body the desktop app
    # parses to surface the upgrade affordance. Skipped silently for Pro.
    check_quota(db, user, "stt")

    audio_bytes = await file.read()
    if not audio_bytes:
        raise HTTPException(400, "empty file")
    if len(audio_bytes) > settings.max_body_bytes:
        raise HTTPException(413, f"body too large; max {settings.max_body_bytes} bytes")

    recognizer = getattr(request.app.state, "recognizer", None)
    if recognizer is None:
        raise HTTPException(503, "recognizer not loaded yet, retry shortly")

    t_decode = time.perf_counter()
    try:
        samples, sr = await run_in_threadpool(decode_to_pcm, audio_bytes)
    except AudioDecodeError as e:
        raise HTTPException(400, str(e)) from e
    decode_sec = time.perf_counter() - t_decode

    audio_sec = len(samples) / sr
    if audio_sec > settings.max_audio_seconds:
        raise HTTPException(
            413, f"audio too long: {audio_sec:.1f}s > {settings.max_audio_seconds:.0f}s",
        )

    lang_hint = LANG_MAP.get((language or "").lower(), "auto")
    t_inf = time.perf_counter()
    text = await run_in_threadpool(transcribe_pcm, recognizer, samples, sr)
    infer_sec = time.perf_counter() - t_inf

    db.add(AuditLog(
        ip=ip, path="/v1/audio/transcriptions",
        audio_sec=audio_sec, infer_sec=infer_sec, status=200,
        user_id=user.id,
    ))
    db.commit()

    log.info(
        "transcribe.ok",
        user_id=user.id, ip=ip, audio_sec=round(audio_sec, 2),
        infer_sec=round(infer_sec, 3), lang_hint=lang_hint,
        chars=len(text),
    )
    return JSONResponse({
        "text": text,
        "audio_sec": round(audio_sec, 3),
        "decode_sec": round(decode_sec, 3),
        "infer_sec": round(infer_sec, 3),
        "rtf": round(infer_sec / max(audio_sec, 1e-6), 4),
        "lang_hint": lang_hint,
    })
