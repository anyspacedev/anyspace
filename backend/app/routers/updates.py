"""Tauri auto-updater manifest endpoint.

The desktop binary already points at
    https://updates.teamship.app/{{target}}/{{arch}}/{{current_version}}
(per src-tauri/tauri.conf.json). We must respond with either:

  - 204 No Content        — client treats as "up to date"
  - 200 application/json  — Tauri v2 update manifest:
        {
          "version": "0.2.0",
          "notes":   "...",
          "pub_date":"2026-04-29T12:00:00Z",
          "platforms": {
            "<target>-<arch>": { "url": "...", "signature": "..." }
          }
        }

Phase 1 has no published release, so we always 204. Phase 4 reads release
metadata from a `releases` table (or directly from GitHub Releases).
"""

from __future__ import annotations

from fastapi import APIRouter, Response

router = APIRouter()


@router.get("/updates/{target}/{arch}/{current_version}")
def update_check(target: str, arch: str, current_version: str) -> Response:  # noqa: ARG001
    return Response(status_code=204)
