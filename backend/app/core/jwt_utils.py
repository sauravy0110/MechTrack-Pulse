"""
Minimal JWT utilities for HS256 tokens.

WHY: The app only needs HS256 encode/decode with expiration checks.
Using a small local implementation avoids pulling in deprecated behavior
from third-party JWT libraries while keeping tokens standards-compliant.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone


class JWTError(Exception):
    """Raised when a JWT is malformed, invalid, or expired."""


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(value + padding)


def _normalize_claim_value(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return int(value.timestamp())
    return value


def encode(payload: dict, key: str, algorithm: str = "HS256") -> str:
    if algorithm != "HS256":
        raise JWTError(f"Unsupported JWT algorithm: {algorithm}")

    header = {"alg": algorithm, "typ": "JWT"}
    normalized_payload = {
        claim: _normalize_claim_value(value)
        for claim, value in payload.items()
    }

    encoded_header = _b64url_encode(
        json.dumps(header, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    encoded_payload = _b64url_encode(
        json.dumps(normalized_payload, separators=(",", ":"), sort_keys=True).encode(
            "utf-8"
        )
    )
    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    signature = hmac.new(
        key.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()

    return f"{encoded_header}.{encoded_payload}.{_b64url_encode(signature)}"


def decode(token: str, key: str, algorithms: list[str] | tuple[str, ...]) -> dict:
    if "HS256" not in algorithms:
        raise JWTError("Unsupported JWT algorithm configuration")

    try:
        encoded_header, encoded_payload, encoded_signature = token.split(".")
    except ValueError as exc:
        raise JWTError("Malformed JWT") from exc

    signing_input = f"{encoded_header}.{encoded_payload}".encode("ascii")
    expected_signature = hmac.new(
        key.encode("utf-8"), signing_input, hashlib.sha256
    ).digest()
    provided_signature = _b64url_decode(encoded_signature)

    if not hmac.compare_digest(expected_signature, provided_signature):
        raise JWTError("Invalid JWT signature")

    try:
        header = json.loads(_b64url_decode(encoded_header))
        payload = json.loads(_b64url_decode(encoded_payload))
    except (json.JSONDecodeError, ValueError, UnicodeDecodeError) as exc:
        raise JWTError("Malformed JWT payload") from exc

    if header.get("alg") != "HS256":
        raise JWTError("Unexpected JWT algorithm")

    current_timestamp = datetime.now(timezone.utc).timestamp()
    exp = payload.get("exp")
    if exp is not None:
        try:
            if float(exp) <= current_timestamp:
                raise JWTError("JWT has expired")
        except (TypeError, ValueError) as exc:
            raise JWTError("Invalid JWT exp claim") from exc

    return payload
