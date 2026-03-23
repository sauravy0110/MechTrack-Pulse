"""
MechTrack Pulse — Machine Schemas
"""

from datetime import datetime
from pydantic import BaseModel, Field


class CreateMachineRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    machine_type: str | None = Field(None, max_length=50)
    grid_x: int = 0
    grid_y: int = 0


class UpdateMachineRequest(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=100)
    machine_type: str | None = Field(None, max_length=50)
    grid_x: int | None = None
    grid_y: int | None = None
    status: str | None = Field(None, pattern="^(idle|active|maintenance)$")


class MachineResponse(BaseModel):
    id: str
    name: str
    machine_type: str | None = None
    grid_x: int
    grid_y: int
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}
