"""Liveness probe.

We treat `recognizer_ready` as the readiness signal — until the lifespan
hook has loaded sherpa-onnx, the transcribe endpoint will 503, so
operators want to see this flip.
"""

from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/healthz")
def healthz(request: Request) -> dict:
    recognizer = getattr(request.app.state, "recognizer", None)
    return {
        "ok": True,
        "recognizer_ready": recognizer is not None,
        "version": request.app.version,
    }
