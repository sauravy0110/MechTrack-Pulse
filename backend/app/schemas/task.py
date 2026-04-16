"""
MechTrack Pulse — Task Schemas

Request/response models for task management.
"""

from datetime import datetime
from pydantic import BaseModel, Field
from uuid import UUID


# ── Create Task ──────────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    description: str | None = None
    priority: str = Field("medium", pattern="^(low|medium|high|critical)$")
    assigned_to: UUID | None = None
    client_id: UUID | None = None
    machine_id: UUID | None = None
    estimated_completion: datetime | None = None


# ── Update Task ──────────────────────────────────────────────

class UpdateTaskRequest(BaseModel):
    title: str | None = Field(None, min_length=2, max_length=255)
    description: str | None = None
    priority: str | None = Field(None, pattern="^(low|medium|high|critical)$")
    status: str | None = None  # CNC pipeline has many status values
    delay_reason: str | None = None
    assigned_to: UUID | None = None
    client_id: UUID | None = None
    machine_id: UUID | None = None
    estimated_completion: datetime | None = None


# ── Task Response ────────────────────────────────────────────

class TaskResponse(BaseModel):
    id: str
    title: str
    description: str | None = None
    status: str
    priority: str
    assigned_to: str | None = None
    client_id: str | None = None
    created_by: str
    machine_id: str | None = None
    estimated_completion: datetime | None = None
    actual_completion: datetime | None = None
    delay_probability: float | None = None
    total_time_spent_seconds: int
    timer_started_at: datetime | None = None
    delay_reason: str | None = None
    created_at: datetime
    updated_at: datetime
    # CNC-specific fields
    is_locked: bool = False
    rework_flag: bool = False
    rework_iteration: int = 0
    part_name: str | None = None
    material_type: str | None = None
    material_batch: str | None = None
    drawing_url: str | None = None
    rework_reason: str | None = None

    model_config = {"from_attributes": True}


# ── Task Log Response ────────────────────────────────────────

class TaskLogResponse(BaseModel):
    id: str
    action: str
    previous_value: str | None = None
    new_value: str | None = None
    details: str | None = None
    user_id: str
    created_at: datetime

    model_config = {"from_attributes": True}


class TaskNoteRequest(BaseModel):
    note: str = Field(..., min_length=2, max_length=2000)


class TaskNoteResponse(BaseModel):
    id: str
    task_id: str
    note: str
    user_id: str
    created_at: datetime


class TaskMediaResponse(BaseModel):
    id: str
    task_id: str
    media_url: str
    media_type: str
    file_name: str | None = None
    file_size_bytes: int | None = None
    uploaded_by: str
    uploaded_at: datetime


# ── Assign Task ──────────────────────────────────────────────

class AssignTaskRequest(BaseModel):
    assigned_to: UUID
