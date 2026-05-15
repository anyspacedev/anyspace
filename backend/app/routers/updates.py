"""Tauri auto-updater manifest endpoint.

The desktop binary asks `GET /updates/{target}/{arch}/{current_version}` on
a background timer. We respond with one of:

  - 204 No Content — client treats as "up to date".
  - 200 application/json — Tauri v2 update manifest:
        {
          "version": "0.1.2",
          "notes":   "...",
          "pub_date":"2026-05-15T19:00:00Z",
          "platforms": {
            "<target>-<arch>": { "url": "...", "signature": "..." }
          }
        }

Implementation:
  - Latest release is read from the GitHub REST API and cached for
    UPDATER_CACHE_TTL_SEC (default 5 min). On API failure we 204 — silent
    degradation is friendlier than "update check failed" toasts.
  - Tauri's updater expects platform-specific *bundle archives* (not the
    user-facing installers `.dmg` / `.AppImage` / `.msi` etc.). The CI
    workflow produces `.app.tar.gz` / `.AppImage.tar.gz` / `.nsis.zip` only
    once signing is wired (phase 5C). Releases missing those assets fall
    back to 204 — exactly the situation v0.1.1 is in today.
  - `signature` in the manifest is the base64 contents of the asset's
    matching `.sig` file. We fetch + cache those alongside the release.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Response

from ..logging import log
from ..settings import Settings, get_settings

router = APIRouter()

_GITHUB_API_BASE = "https://api.github.com"

# Tauri's URL template substitutes {target}/{arch} from the running platform's
# Rust target triple. We map those onto the asset-name fragments the CI
# workflow uses, plus the bundle/sig extensions Tauri v2's updater produces.
_PLATFORM_MAP: dict[tuple[str, str], dict[str, str]] = {
    ("darwin",  "aarch64"): {"asset_kind": "mac-arm64",   "bundle_ext": ".app.tar.gz"},
    ("darwin",  "x86_64"):  {"asset_kind": "mac-x64",     "bundle_ext": ".app.tar.gz"},
    ("linux",   "x86_64"):  {"asset_kind": "linux-x64",   "bundle_ext": ".AppImage.tar.gz"},
    ("windows", "x86_64"):  {"asset_kind": "windows-x64", "bundle_ext": ".nsis.zip"},
}

# Module-level cache shared across requests. Guarded by `_cache_lock` so the
# first concurrent burst doesn't all hit GitHub in parallel (thundering herd).
_cache: dict[str, Any] = {"value": None, "expires_at": 0.0}
_cache_lock = asyncio.Lock()


def _parse_version(s: str) -> tuple[int, ...]:
    """Lenient semver-ish parse: 'v0.1.2' → (0, 1, 2), '0.1.2-rc1' → (0, 1, 2).
    Pre-release suffixes are stripped — we don't ship those to the stable
    channel, and treating 0.1.2-rc1 == 0.1.2 keeps stable users on the GA."""
    s = s.strip().lstrip("v").split("-", 1)[0]
    try:
        return tuple(int(p) for p in s.split("."))
    except ValueError:
        return (0,)


async def _gh_get(
    client: httpx.AsyncClient, url: str, token: str,
) -> httpx.Response:
    headers = {"Accept": "application/vnd.github+json",
               "User-Agent": "anyspace-backend/updater"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return await client.get(url, headers=headers, timeout=10.0)


def _find_asset(
    assets: list[dict[str, Any]], kind: str, suffix: str,
) -> dict[str, Any] | None:
    """First asset whose name contains the platform fragment AND ends with the
    extension (e.g. kind='mac-arm64' + suffix='.app.tar.gz')."""
    for a in assets:
        name = a.get("name", "")
        if kind in name and name.endswith(suffix):
            return a
    return None


async def _download_text(
    client: httpx.AsyncClient, url: str,
) -> str | None:
    try:
        r = await client.get(url, timeout=10.0)
        if r.status_code != 200:
            return None
        return r.text
    except httpx.HTTPError:
        return None


async def _build_manifest(s: Settings) -> dict[str, Any] | None:
    """Fetch the latest release + each platform's `.sig` contents and assemble
    the manifest. Returns None if GitHub is unreachable OR the latest release
    has no signed assets for any platform (in which case we 204 callers)."""
    url = f"{_GITHUB_API_BASE}/repos/{s.github_owner}/{s.github_repo}/releases/latest"
    try:
        async with httpx.AsyncClient(follow_redirects=True) as client:
            resp = await _gh_get(client, url, s.github_token)
            if resp.status_code != 200:
                log.warning(
                    "updater.github.fetch_failed",
                    status=resp.status_code, url=url,
                )
                return None
            release = resp.json()

            tag = release.get("tag_name", "")
            version = tag.lstrip("v")
            notes = release.get("body") or ""
            pub_date = release.get("published_at") or ""
            assets = release.get("assets") or []

            platforms: dict[str, dict[str, str]] = {}
            for (target, arch), spec in _PLATFORM_MAP.items():
                bundle = _find_asset(assets, spec["asset_kind"], spec["bundle_ext"])
                if not bundle:
                    continue
                sig = _find_asset(
                    assets, spec["asset_kind"], spec["bundle_ext"] + ".sig",
                )
                if not sig:
                    # Bundle without signature = unsigned build. Plugin would
                    # reject it; don't even offer.
                    continue
                sig_text = await _download_text(client, sig["browser_download_url"])
                if not sig_text:
                    continue
                platforms[f"{target}-{arch}"] = {
                    "url": bundle["browser_download_url"],
                    "signature": sig_text.strip(),
                }

            if not platforms:
                return None
            return {
                "version":   version,
                "notes":     notes,
                "pub_date":  pub_date,
                "platforms": platforms,
                "_tag":      tag,        # used internally for version compare
            }
    except httpx.HTTPError as e:
        log.warning("updater.github.exception", error=str(e))
        return None


async def _cached_manifest(s: Settings) -> dict[str, Any] | None:
    now = time.monotonic()
    if _cache["value"] is not None and _cache["expires_at"] > now:
        return _cache["value"]
    async with _cache_lock:
        # Re-check under the lock — another request may have populated it
        # while we were waiting.
        if _cache["value"] is not None and _cache["expires_at"] > time.monotonic():
            return _cache["value"]
        manifest = await _build_manifest(s)
        _cache["value"] = manifest
        _cache["expires_at"] = time.monotonic() + s.updater_cache_ttl_sec
        return manifest


@router.get("/updates/{target}/{arch}/{current_version}")
async def update_check(
    target: str,
    arch: str,
    current_version: str,
    settings: Settings = Depends(get_settings),
) -> Response:
    # Unknown platform → 204 rather than 404. A 404 here can surface as a
    # confusing "update check failed" in Tauri; silent no-op is friendlier.
    if (target, arch) not in _PLATFORM_MAP:
        return Response(status_code=204)

    manifest = await _cached_manifest(settings)
    if manifest is None:
        return Response(status_code=204)

    # Caller is already on or past the latest tag → up-to-date.
    if _parse_version(current_version) >= _parse_version(manifest["_tag"]):
        return Response(status_code=204)

    platform_key = f"{target}-{arch}"
    if platform_key not in manifest["platforms"]:
        # Latest release exists but lacks a signed bundle for this platform.
        return Response(status_code=204)

    # Strip the internal `_tag` marker; emit only the platform the caller
    # asked for (smaller payload + the plugin only reads its own key).
    body = {
        "version":   manifest["version"],
        "notes":     manifest["notes"],
        "pub_date":  manifest["pub_date"],
        "platforms": {platform_key: manifest["platforms"][platform_key]},
    }
    log.info(
        "updater.serve",
        target=target, arch=arch,
        from_version=current_version, to_version=manifest["version"],
    )
    return Response(
        status_code=200,
        media_type="application/json",
        content=json.dumps(body),
    )


def _reset_cache_for_tests() -> None:
    """Test hook — pytest fixtures call this to start each case with a cold
    cache. Module-level state is otherwise fine in production (single worker)."""
    _cache["value"] = None
    _cache["expires_at"] = 0.0
