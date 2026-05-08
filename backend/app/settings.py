"""Process configuration via environment variables (or .env in dev)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    database_url: str = "sqlite:///./data/teamship.db"
    model_cache_dir: Path = Path("./data/models")

    log_level: str = "info"
    log_json: bool = False

    listen_host: str = "127.0.0.1"
    listen_port: int = 9100

    trusted_proxy_ips: str = "127.0.0.1,::1,100.64.0.0/10"

    rate_limit_per_min: int = 60
    rate_limit_per_hour: int = 600
    max_audio_seconds: float = 600.0
    max_body_bytes: int = 25 * 1024 * 1024

    cors_allow_origins: str = (
        "tauri://localhost,https://teamship.app,https://www.teamship.app"
    )

    # Sherpa-onnx model archive on Hugging Face.
    sherpa_hf_repo: str = (
        "csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17"
    )
    sherpa_model_file: str = "model.int8.onnx"
    sherpa_tokens_file: str = "tokens.txt"
    sherpa_num_threads: int = Field(default=4)

    # Clerk auth — pk/sk live in env. The Frontend API domain is encoded in
    # the publishable key (base64 after `pk_test_` / `pk_live_`); we decode
    # it lazily so settings.py doesn't crash when the key is unset in tests.
    clerk_publishable_key: str = ""
    clerk_secret_key: str = ""
    clerk_frontend_api: str = ""        # e.g. https://<slug>.clerk.accounts.dev
    clerk_webhook_signing_secret: str = ""

    # JWT acceptance window (Clerk default access token TTL is 60s; allow
    # small clock skew).
    clerk_jwt_leeway_sec: int = 30

    # /v1/chat/completions proxy. The desktop client calls our endpoint with
    # an OpenAI-shaped body; we resolve the model alias against an allow-list
    # and stream the upstream provider's response straight back.
    llm_upstream_base: str = ""        # e.g. https://api.openai.com/v1
    llm_upstream_key: str = ""
    llm_default_model: str = "gpt-4o-mini"
    llm_request_timeout_sec: float = 120.0

    @property
    def clerk_jwks_url(self) -> str:
        return f"{self.clerk_frontend_api.rstrip('/')}/.well-known/jwks.json"

    @property
    def clerk_issuer(self) -> str:
        return self.clerk_frontend_api.rstrip("/")

    @property
    def cors_origins_list(self) -> list[str]:
        return [s.strip() for s in self.cors_allow_origins.split(",") if s.strip()]

    @property
    def trusted_proxy_list(self) -> list[str]:
        return [s.strip() for s in self.trusted_proxy_ips.split(",") if s.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
