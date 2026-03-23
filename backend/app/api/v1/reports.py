"""
MechTrack Pulse — Report API Routes

Endpoints:
  POST /api/v1/reports/generate  → Generate a report
  GET  /api/v1/reports/          → List reports
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.db.database import get_db
from app.models.user import User
from app.services.report_service import generate_report, list_reports

router = APIRouter()


class GenerateReportRequest(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    report_type: str = Field(..., pattern="^(daily|weekly|custom)$")
    period_start: datetime
    period_end: datetime


@router.post("/generate")
def generate_report_route(
    request: GenerateReportRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Generate a report for the specified period."""
    if request.period_end <= request.period_start:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    result = generate_report(
        db=db,
        company_id=current_user.company_id,
        generated_by=current_user.id,
        report_type=request.report_type,
        title=request.title,
        period_start=request.period_start,
        period_end=request.period_end,
    )
    return result


@router.get("/")
def list_reports_route(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """List all reports for the company."""
    return list_reports(db, current_user.company_id)
