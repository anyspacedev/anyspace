"""Billing stubs (Stripe integration lands in phase 3)."""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/v1/billing")

_NOT_YET = {"detail": "not implemented in phase 1", "phase": 3}


def _stub() -> JSONResponse:
    return JSONResponse(status_code=501, content=_NOT_YET)


@router.post("/checkout")
def checkout() -> JSONResponse:
    return _stub()


@router.post("/portal")
def portal() -> JSONResponse:
    return _stub()


@router.post("/webhook")
def webhook() -> JSONResponse:
    return _stub()
