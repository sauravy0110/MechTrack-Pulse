"""
MechTrack Pulse — Rate Limiting

Uses SlowAPI (based on limits) to protect APIs from abuse.
IP-based rate limiting is used by default.
"""

from slowapi import Limiter
from slowapi.util import get_remote_address
from app.core.config import get_settings

settings = get_settings()

# Global limiter instance
# Rate limits are applied per-route using @limiter.limit("100/minute")
limiter = Limiter(
    key_func=get_remote_address, 
    default_limits=["200/minute"],
    enabled=settings.ENVIRONMENT != "testing"
)
