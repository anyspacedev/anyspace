"""FastAPI application factory.

Lifespan is the modern (non-deprecated) place to load heavy singletons
like the sherpa-onnx recognizer. We park it on `app.state.recognizer`
so routers retrieve it via `request.app.state.recognizer`.
"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

from .logging import configure_logging, log
from .routers import account, billing, chat, health, transcribe, updates, webhooks
from .services.asr import build_recognizer
from .settings import get_settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(level=settings.log_level, json_logs=settings.log_json)
    log.info("startup.begin", db=settings.database_url, port=settings.listen_port)
    # Loading sherpa-onnx involves disk I/O + model parse — punt to a thread
    # so we don't block the event loop's startup phase.
    app.state.recognizer = await run_in_threadpool(build_recognizer)
    log.info("startup.recognizer_ready")
    try:
        yield
    finally:
        log.info("shutdown")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="AnySpace backend",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(updates.router)
    app.include_router(transcribe.router)
    app.include_router(chat.router)
    app.include_router(account.router)
    app.include_router(billing.router)
    app.include_router(webhooks.router)
    return app


app = create_app()


def main() -> int:
    import uvicorn
    settings = get_settings()
    uvicorn.run(
        "app.main:app",
        host=settings.listen_host,
        port=settings.listen_port,
        log_level=settings.log_level,
        # One worker; sherpa-onnx is CPU-bound and SQLite handles writes best
        # with a single writer.
        workers=1,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
