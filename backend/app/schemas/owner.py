"""
MechTrack Pulse — Owner Schemas
"""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CompanyProfileResponse(BaseModel):
    id: UUID
    name: str
    gst_number: str | None = None
    msme_number: str | None = None
    industry_type: str | None = None
    address: str | None = None
    city: str | None = None
    state: str | None = None
    owner_email: str
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class UpdateCompanyProfileRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=255)
    gst_number: str | None = Field(None, max_length=15)
    msme_number: str | None = Field(None, max_length=20)
    industry_type: str | None = Field(None, max_length=100)
    address: str | None = None
    city: str | None = Field(None, max_length=100)
    state: str | None = Field(None, max_length=100)


class UsageMetricResponse(BaseModel):
    used: int
    limit: int
    remaining: int | None
    utilization_percent: float | None


class SubscriptionSummaryResponse(BaseModel):
    plan: str
    payment_status: str
    ai_enabled: bool
    started_at: datetime | None
    expires_at: datetime | None
    usage: dict[str, UsageMetricResponse]


class TaskOperationsSummaryResponse(BaseModel):
    total: int
    completed: int
    delayed: int
    in_progress: int
    idle: int
    queued: int
    paused: int
    completion_rate: float


class MachineOperationsSummaryResponse(BaseModel):
    total: int
    active: int
    idle: int
    maintenance: int


class TeamCompositionResponse(BaseModel):
    total_active_users: int
    supervisors: int
    operators: int
    clients: int
    active_operators: int
    offline_operators: int


class ReportsSummaryResponse(BaseModel):
    total_reports: int
    latest_generated_at: datetime | None


class WatchlistSummaryResponse(BaseModel):
    high_risk_tasks: int
    unassigned_tasks: int
    overloaded_operators: int


class OwnerBusinessOverviewResponse(BaseModel):
    company: CompanyProfileResponse
    subscription: SubscriptionSummaryResponse
    tasks: TaskOperationsSummaryResponse
    machines: MachineOperationsSummaryResponse
    team: TeamCompositionResponse
    reports: ReportsSummaryResponse
    watchlist: WatchlistSummaryResponse


class KPIDashboardResponse(BaseModel):
    total_tasks: int
    completed_tasks: int
    delayed_tasks: int
    in_progress_tasks: int
    
    productivity_percent: float
    delay_percent: float
    
    total_machines: int
    active_machines: int
    
    active_operators: int
