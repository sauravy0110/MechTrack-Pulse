"""
MechTrack Pulse — Auth Schemas

WHY separate schemas from models:
- Models = database shape (SQLAlchemy)
- Schemas = API shape (Pydantic)
Keeps DB internals hidden from API consumers.
"""

from pydantic import BaseModel, EmailStr, Field


# ── Login ────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    must_change_password: bool = False


class RefreshRequest(BaseModel):
    refresh_token: str


# ── Password Change ──────────────────────────────────────────

class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8)


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    new_password: str = Field(..., min_length=8)


# ── Current User Response ────────────────────────────────────

class UserProfileResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    company_id: str
    department: str | None = None
    phone: str | None = None
    must_change_password: bool

    model_config = {"from_attributes": True}
