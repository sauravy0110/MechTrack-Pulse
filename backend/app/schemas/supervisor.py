"""
MechTrack Pulse — Supervisor Schemas
"""

from pydantic import BaseModel, Field
from datetime import time
from uuid import UUID

# ── Shifts ───────────────────────────────────────────────────

class ShiftCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    start_time: time
    end_time: time

class ShiftResponse(BaseModel):
    id: str
    company_id: str
    name: str
    start_time: time
    end_time: time

    model_config = {"from_attributes": True}


# ── Alert Config ─────────────────────────────────────────────

class AlertConfigCreate(BaseModel):
    alert_type: str = Field(..., pattern="^(machine_delay|operator_overload|idle_warning)$")
    threshold_value: float = Field(..., gt=0)
    is_active: bool = True
    message_template: str | None = None

class AlertConfigResponse(BaseModel):
    id: str
    company_id: str
    alert_type: str
    threshold_value: float
    is_active: bool
    message_template: str | None = None

    model_config = {"from_attributes": True}
