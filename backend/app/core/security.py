"""
MechTrack Pulse — Security Utilities

WHY: Centralized security functions.
- Password hashing (bcrypt, 12 rounds)
- Password validation (policy enforcement)
- JWT token creation & verification
- Temp password generation
"""

import re
import secrets
import string
import uuid
from datetime import datetime, timedelta, timezone

from passlib.context import CryptContext

from app.core.config import get_settings
from app.core.jwt_utils import JWTError, decode, encode

settings = get_settings()

# ── Password Hashing ─────────────────────────────────────────

pwd_context = CryptContext(
    schemes=["bcrypt"],
    deprecated="auto",
    bcrypt__rounds=settings.BCRYPT_ROUNDS,
)


def hash_password(password: str) -> str:
    """Hash a plaintext password using bcrypt."""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against its hash."""
    return pwd_context.verify(plain_password, hashed_password)


# ── Password Policy ──────────────────────────────────────────

def validate_password_strength(password: str) -> tuple[bool, str]:
    """
    Enforce password policy:
    - Min 8 characters
    - At least 1 uppercase, 1 lowercase, 1 digit, 1 special char

    Returns (is_valid, error_message).
    """
    if len(password) < 8:
        return False, "Password must be at least 8 characters"
    if not re.search(r"[A-Z]", password):
        return False, "Password must contain at least one uppercase letter"
    if not re.search(r"[a-z]", password):
        return False, "Password must contain at least one lowercase letter"
    if not re.search(r"\d", password):
        return False, "Password must contain at least one digit"
    if not re.search(r"[!@#$%^&*(),.?\":{}|<>]", password):
        return False, "Password must contain at least one special character"
    return True, ""


def generate_temp_password(length: int = 12) -> str:
    """
    Generate a random temporary password that meets policy.
    WHY: Operators get auto-generated passwords from Owner.
    """
    # Ensure at least one of each required type
    password = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
        secrets.choice("!@#$%^&*"),
    ]
    # Fill remaining length with random chars
    remaining = length - len(password)
    all_chars = string.ascii_letters + string.digits + "!@#$%^&*"
    password.extend(secrets.choice(all_chars) for _ in range(remaining))

    # Shuffle to avoid predictable positions
    secrets.SystemRandom().shuffle(password)
    return "".join(password)


# ── JWT Tokens ───────────────────────────────────────────────

def create_access_token(
    data: dict,
    expires_delta: timedelta | None = None,
) -> str:
    """
    Create a JWT access token.
    Payload includes: sub (user_id), company_id, role, type, exp
    """
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + (
        expires_delta
        or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    to_encode.update({"exp": expire, "type": "access", "jti": str(uuid.uuid4())})
    return encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    """Create a JWT refresh token (longer-lived)."""
    to_encode = data.copy()
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.REFRESH_TOKEN_EXPIRE_DAYS
    )
    to_encode.update({"exp": expire, "type": "refresh", "jti": str(uuid.uuid4())})
    return encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict | None:
    """
    Decode and validate a JWT token.
    Returns payload dict or None if invalid/expired.
    """
    try:
        payload = decode(
            token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
        )
        return payload
    except JWTError:
        return None


def create_password_reset_token(email: str) -> str:
    """Create a short-lived token for password resets."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=15)
    to_encode = {"sub": email, "type": "reset", "exp": expire, "jti": str(uuid.uuid4())}
    return encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def verify_password_reset_token(token: str) -> str | None:
    """Verify reset token and return the email if valid."""
    try:
        payload = decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        if payload.get("type") != "reset":
            return None
        return payload.get("sub")
    except JWTError:
        return None
