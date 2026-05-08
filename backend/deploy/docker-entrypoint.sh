#!/usr/bin/env bash
set -euo pipefail

# Ensure the SQLite parent dir exists on a fresh volume. Strips
# `sqlite:///` (3 slashes = relative) or `sqlite:////` (4 slashes = absolute)
# down to the filesystem path, then mkdir -p the directory.
db_url="${DATABASE_URL:-}"
case "$db_url" in
    sqlite:////*)
        db_path="/${db_url#sqlite:////}"
        mkdir -p "$(dirname "$db_path")"
        ;;
    sqlite:///*)
        db_path="${db_url#sqlite:///}"
        mkdir -p "$(dirname "$db_path")"
        ;;
esac

echo "[entrypoint] alembic upgrade head"
alembic upgrade head

exec "$@"
