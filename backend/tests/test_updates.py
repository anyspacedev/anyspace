"""Auto-updater manifest endpoint tests.

The endpoint is async + makes real httpx calls to GitHub. We mock httpx at
the module-attribute level so no test ever touches the network.
"""

from __future__ import annotations

import time
from contextlib import asynccontextmanager
from typing import Any

import httpx
import pytest

from app.routers import updates as updates_module


# --- helpers ----------------------------------------------------------------


def _fake_release(tag: str = "v0.1.2", assets: list[dict[str, Any]] | None = None) -> dict:
    if assets is None:
        assets = _signed_assets_for_all_platforms(tag)
    return {
        "tag_name":     tag,
        "body":         f"Release notes for {tag}",
        "published_at": "2026-05-15T19:00:00Z",
        "assets":       assets,
    }


def _signed_assets_for_all_platforms(tag: str) -> list[dict[str, Any]]:
    """Mimic the asset set the CI workflow will produce once signing is wired —
    one `.tar.gz`/`.zip` plus its `.sig` per platform."""
    v = tag.lstrip("v")
    out: list[dict[str, Any]] = []
    pairs = [
        (f"AnySpace-{v}-mac-arm64.app.tar.gz",      "darwin-aarch64"),
        (f"AnySpace-{v}-mac-x64.app.tar.gz",        "darwin-x86_64"),
        (f"AnySpace-{v}-linux-x64.AppImage.tar.gz", "linux-x86_64"),
        (f"AnySpace-{v}-windows-x64.nsis.zip",      "windows-x86_64"),
    ]
    for name, _ in pairs:
        url = f"https://github.com/anyspacedev/anyspace/releases/download/{tag}/{name}"
        out.append({"name": name, "browser_download_url": url})
        out.append({"name": name + ".sig",
                    "browser_download_url": url + ".sig"})
    return out


class _FakeResponse:
    def __init__(self, status_code: int, *, json_body: dict | None = None,
                 text_body: str = "") -> None:
        self.status_code = status_code
        self._json = json_body
        self.text = text_body

    def json(self) -> dict:
        return self._json or {}


def _install_fake_httpx(monkeypatch, *, release_status: int = 200,
                       release: dict | None = None,
                       sig_text: str | None = "AAAAfakesignature==",
                       sig_status: int = 200,
                       raise_on_release: bool = False) -> dict[str, int]:
    """Patch `httpx.AsyncClient` so the router never touches the network.

    Returns a dict whose `calls` key counts GitHub-API release fetches —
    cache tests use this to verify hits don't re-fetch.
    """
    counters = {"calls": 0, "sig_calls": 0}

    @asynccontextmanager
    async def _ctx(*_args, **_kwargs):
        yield _Client()

    class _Client:
        async def get(self, url: str, *_args, **_kwargs):
            if url.endswith(".sig"):
                counters["sig_calls"] += 1
                if sig_text is None:
                    return _FakeResponse(sig_status, text_body="")
                return _FakeResponse(sig_status, text_body=sig_text)
            # Release fetch.
            counters["calls"] += 1
            if raise_on_release:
                raise httpx.ConnectError("network down")
            return _FakeResponse(
                release_status,
                json_body=release if release is not None else _fake_release(),
            )

    monkeypatch.setattr(updates_module.httpx, "AsyncClient", _ctx)
    return counters


@pytest.fixture(autouse=True)
def _cold_cache_each_test():
    """Module-level cache is fine in prod (one process) but test isolation
    needs a cold start per case."""
    updates_module._reset_cache_for_tests()
    yield
    updates_module._reset_cache_for_tests()


# --- platform routing -------------------------------------------------------


def test_unknown_platform_returns_204(client, monkeypatch):
    """Tauri sends the running platform's target triple; anything off our
    known list (here: a fake 'plan9' OS) should silently 204."""
    _install_fake_httpx(monkeypatch)
    r = client.get("/updates/plan9/sparc/0.1.0")
    assert r.status_code == 204


def test_unknown_arch_returns_204(client, monkeypatch):
    """linux/aarch64 isn't in the platform map yet (no CI bundle)."""
    _install_fake_httpx(monkeypatch)
    r = client.get("/updates/linux/aarch64/0.1.0")
    assert r.status_code == 204


# --- graceful GitHub-API failure modes -------------------------------------


def test_github_5xx_falls_back_to_204(client, monkeypatch):
    """API outage → 204 (no scary 'update check failed' toast for users)."""
    _install_fake_httpx(monkeypatch, release_status=503)
    r = client.get("/updates/darwin/aarch64/0.1.0")
    assert r.status_code == 204


def test_github_network_error_falls_back_to_204(client, monkeypatch):
    """ConnectError from httpx is also a graceful 204."""
    _install_fake_httpx(monkeypatch, raise_on_release=True)
    r = client.get("/updates/darwin/aarch64/0.1.0")
    assert r.status_code == 204


# --- "no signed assets yet" (the v0.1.1 situation today) -------------------


def test_unsigned_release_returns_204(client, monkeypatch):
    """Release exists with the user-facing installers but no .tar.gz/.sig
    pairs — exactly the v0.1.1 state right now. Should 204 every platform."""
    unsigned = _fake_release(assets=[
        {"name": "AnySpace-0.1.2-mac-arm64.dmg",
         "browser_download_url": "https://example.test/x.dmg"},
        {"name": "AnySpace-0.1.2-linux-x64.AppImage",
         "browser_download_url": "https://example.test/x.AppImage"},
    ])
    _install_fake_httpx(monkeypatch, release=unsigned)
    r = client.get("/updates/darwin/aarch64/0.1.0")
    assert r.status_code == 204


def test_bundle_without_sig_returns_204(client, monkeypatch):
    """The .tar.gz exists but no matching .sig — we refuse to serve it (plugin
    would reject the download anyway). Half-signed releases shouldn't update
    anyone."""
    half = _fake_release(assets=[
        {"name": "AnySpace-0.1.2-mac-arm64.app.tar.gz",
         "browser_download_url": "https://example.test/x.tar.gz"},
        # ^ no .sig partner
    ])
    _install_fake_httpx(monkeypatch, release=half)
    r = client.get("/updates/darwin/aarch64/0.1.0")
    assert r.status_code == 204


# --- happy path ------------------------------------------------------------


def test_outdated_client_receives_manifest(client, monkeypatch):
    _install_fake_httpx(monkeypatch, sig_text="dW50cnVzdGVkOmZha2Vfc2lnXw==\n")
    r = client.get("/updates/darwin/aarch64/0.1.0")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["version"] == "0.1.2"
    assert body["pub_date"] == "2026-05-15T19:00:00Z"
    assert body["notes"].startswith("Release notes")
    # Only the platform the caller asked for is in the payload.
    assert set(body["platforms"].keys()) == {"darwin-aarch64"}
    plat = body["platforms"]["darwin-aarch64"]
    assert plat["url"].endswith(".app.tar.gz")
    # Signature contents are passed through verbatim (stripped of trailing \n).
    assert plat["signature"] == "dW50cnVzdGVkOmZha2Vfc2lnXw=="


def test_up_to_date_client_gets_204(client, monkeypatch):
    _install_fake_httpx(monkeypatch)  # latest is v0.1.2
    r = client.get("/updates/darwin/aarch64/0.1.2")
    assert r.status_code == 204


def test_newer_client_than_latest_also_204(client, monkeypatch):
    """A user on a dev/pre-release build that's newer than what GitHub
    advertises should not get rolled back."""
    _install_fake_httpx(monkeypatch)
    r = client.get("/updates/darwin/aarch64/9.9.9")
    assert r.status_code == 204


def test_prerelease_suffix_is_stripped(client, monkeypatch):
    """0.1.2-rc1 callers should match a 0.1.2 GA tag exactly (treated equal)
    so they don't repeatedly bounce off the same version."""
    _install_fake_httpx(monkeypatch)
    r = client.get("/updates/darwin/aarch64/0.1.2-rc1")
    assert r.status_code == 204


# --- platform-specific routing in the manifest -----------------------------


@pytest.mark.parametrize("target,arch,expected_url_suffix", [
    ("darwin",  "aarch64", "mac-arm64.app.tar.gz"),
    ("darwin",  "x86_64",  "mac-x64.app.tar.gz"),
    ("linux",   "x86_64",  "linux-x64.AppImage.tar.gz"),
    ("windows", "x86_64",  "windows-x64.nsis.zip"),
])
def test_each_known_platform_gets_its_bundle(
    client, monkeypatch, target, arch, expected_url_suffix,
):
    _install_fake_httpx(monkeypatch)
    r = client.get(f"/updates/{target}/{arch}/0.1.0")
    assert r.status_code == 200, r.text
    plat = r.json()["platforms"][f"{target}-{arch}"]
    assert plat["url"].endswith(expected_url_suffix)


# --- cache behaviour --------------------------------------------------------


def test_cache_hits_skip_github(client, monkeypatch):
    """Two requests within TTL → one GitHub fetch."""
    counters = _install_fake_httpx(monkeypatch)
    assert client.get("/updates/darwin/aarch64/0.1.0").status_code == 200
    assert client.get("/updates/linux/x86_64/0.1.0").status_code == 200
    # Two clients, two different platforms — single backend cache hit.
    assert counters["calls"] == 1


def test_cache_expires_after_ttl(client, monkeypatch):
    """Past TTL, the next request refetches."""
    counters = _install_fake_httpx(monkeypatch)
    assert client.get("/updates/darwin/aarch64/0.1.0").status_code == 200
    assert counters["calls"] == 1
    # Force expiry by pushing the recorded expires_at into the past.
    updates_module._cache["expires_at"] = time.monotonic() - 1
    assert client.get("/updates/darwin/aarch64/0.1.0").status_code == 200
    assert counters["calls"] == 2
