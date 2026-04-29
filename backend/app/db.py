"""SQLAlchemy engine + session factory.

SQLite in phase 1, Postgres in phase 2 — swap via DATABASE_URL only.
The single explicit SQLite quirk we handle: enable WAL + foreign_keys,
and pass `check_same_thread=False` so FastAPI's async route handlers
can borrow connections from a thread pool.
"""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .settings import get_settings


class Base(DeclarativeBase):
    pass


def _make_engine() -> Engine:
    settings = get_settings()
    url = settings.database_url
    connect_args: dict = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False
        # Make sure ./data/ exists so sqlite can open the file.
        if "///" in url:
            db_path = Path(url.split("///", 1)[1].lstrip("/"))
            db_path.parent.mkdir(parents=True, exist_ok=True)
    return create_engine(url, connect_args=connect_args, future=True)


engine = _make_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    if engine.url.get_backend_name() != "sqlite":
        return
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


def get_db() -> Iterator[Session]:
    """FastAPI dep: yield a session, close it after the request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
