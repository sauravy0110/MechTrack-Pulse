"""
MechTrack Pulse — Redis Configuration

WHY: Global synchronous Redis client for token blacklisting
and other simple caching needs. If Redis is unavailable,
fall back to an in-memory TTL store so auth still works locally.
"""

from datetime import datetime, timedelta, timezone

import redis
from redis.exceptions import RedisError

from app.core.config import get_settings

settings = get_settings()


class SafeRedisClient:
    """Best-effort Redis wrapper with an in-memory fallback."""

    def __init__(self, url: str):
        self._client = redis.Redis.from_url(url, decode_responses=True)
        self._fallback: dict[str, tuple[str, datetime]] = {}

    def _get_fallback(self, key: str) -> str | None:
        value = self._fallback.get(key)
        if not value:
            return None

        payload, expires_at = value
        if datetime.now(timezone.utc) >= expires_at:
            self._fallback.pop(key, None)
            return None
        return payload

    def get(self, key: str) -> str | None:
        try:
            return self._client.get(key)
        except RedisError:
            return self._get_fallback(key)

    def setex(self, key: str, ttl: int, value: str) -> None:
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=max(ttl, 0))
        try:
            self._client.setex(key, ttl, value)
        except RedisError:
            self._fallback[key] = (value, expires_at)


redis_client = SafeRedisClient(settings.REDIS_URL)
