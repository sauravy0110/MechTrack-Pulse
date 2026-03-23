from datetime import timedelta

from app.core.security import create_access_token, decode_token


def test_access_token_round_trip():
    token = create_access_token(
        {
            "sub": "user-123",
            "company_id": "company-456",
            "role": "owner",
        }
    )

    payload = decode_token(token)

    assert payload is not None
    assert payload["sub"] == "user-123"
    assert payload["company_id"] == "company-456"
    assert payload["role"] == "owner"
    assert payload["type"] == "access"
    assert "exp" in payload
    assert "jti" in payload


def test_expired_access_token_returns_none():
    token = create_access_token(
        {"sub": "user-123"},
        expires_delta=timedelta(seconds=-1),
    )

    assert decode_token(token) is None


def test_tampered_token_returns_none():
    token = create_access_token({"sub": "user-123"})
    tampered_token = f"{token[:-1]}{'a' if token[-1] != 'a' else 'b'}"

    assert decode_token(tampered_token) is None
