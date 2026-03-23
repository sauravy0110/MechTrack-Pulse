"""
MechTrack Pulse — Company Schemas

Used for company registration (public) and platform admin views.
"""

from datetime import datetime
from uuid import UUID
from pydantic import BaseModel, EmailStr, Field


# ── Company Registration ─────────────────────────────────────

class CompanyRegisterRequest(BaseModel):
    """Public registration — submitted by a company wanting to join."""
    company_name: str = Field(..., min_length=2, max_length=255)
    gst_number: str | None = Field(None, max_length=15)
    msme_number: str | None = Field(None, max_length=20)
    industry_type: str | None = Field(None, max_length=100)
    address: str | None = None
    city: str | None = Field(None, max_length=100)
    state: str | None = Field(None, max_length=100)

    # Owner details — created when company is approved
    owner_name: str = Field(..., min_length=2, max_length=100)
    owner_email: EmailStr
    owner_phone: str | None = Field(None, max_length=15)


class CompanyResponse(BaseModel):
    id: UUID
    name: str
    gst_number: str | None = None
    msme_number: str | None = None
    industry_type: str | None = None
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class CompanyStatusResponse(BaseModel):
    id: UUID
    name: str
    status: str
