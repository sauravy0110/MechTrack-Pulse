"""
MechTrack Pulse — User Schemas

Request/response models for user management.
Owner creates users → temp password flow.
"""

from datetime import datetime
from pydantic import BaseModel, EmailStr, Field


# ── Create User (Owner only) ────────────────────────────────

class CreateUserRequest(BaseModel):
    """Owner creates a user inside their company."""
    email: EmailStr
    full_name: str = Field(..., min_length=2, max_length=100)
    role: str = Field(..., pattern="^(supervisor|operator|client)$")
    phone: str | None = Field(None, max_length=15)
    department: str | None = Field(None, max_length=100)


class CreateUserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    company_id: str
    temp_password: str
    must_change_password: bool = True

    model_config = {"from_attributes": True}


# ── User List / Detail ──────────────────────────────────────

class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str
    role: str
    department: str | None = None
    phone: str | None = None
    is_active: bool
    is_on_duty: bool = False
    current_task_count: int = 0
    last_active_at: datetime | None = None
    must_change_password: bool
    last_login_at: datetime | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Update User ─────────────────────────────────────────────

class UpdateUserRequest(BaseModel):
    full_name: str | None = Field(None, min_length=2, max_length=100)
    department: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=15)
    role: str | None = Field(None, pattern="^(supervisor|operator|client)$")
    is_active: bool | None = None
