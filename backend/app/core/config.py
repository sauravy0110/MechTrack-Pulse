"""
MechTrack Pulse — Application Settings

WHY: Centralized config using Pydantic Settings.
- Reads from .env file automatically
- Type validation on startup (fails fast if missing)
- Single source of truth for all config values
"""

from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # ── App ──────────────────────────────────────────────────
    APP_NAME: str = "MechTrack Pulse"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = False
    ENVIRONMENT: str = "production"

    # ── Database ─────────────────────────────────────────────
    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379/0"
    DB_POOL_SIZE: int = 20
    DB_MAX_OVERFLOW: int = 50

    # ── Security & CORS ──────────────────────────────────────
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:4173",
        "http://127.0.0.1:4173",
    ]

    # ── JWT ──────────────────────────────────────────────────
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # ── Security ─────────────────────────────────────────────
    MAX_LOGIN_ATTEMPTS: int = 5
    LOCKOUT_DURATION_MINUTES: int = 30
    BCRYPT_ROUNDS: int = 12

    # ── Platform Admin Seed ──────────────────────────────────
    PLATFORM_ADMIN_EMAIL: str = "admin@mechtrackpulse.com"
    PLATFORM_ADMIN_PASSWORD: str = "Admin@12345"

    # ── SMTP Email Delivery ──────────────────────────────────
    SMTP_HOST: str | None = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM_EMAIL: str = "noreply@mechtrackpulse.com"
    SMTP_FROM_NAME: str = "MechTrack Pulse"
    SMTP_USE_TLS: bool = True
    SMTP_USE_SSL: bool = False

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


@lru_cache()
def get_settings() -> Settings:
    """
    Cached settings instance.
    WHY lru_cache: .env is read once, not on every request.
    """
    return Settings()
