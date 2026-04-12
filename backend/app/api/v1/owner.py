"""
MechTrack Pulse — Owner API Router

Endpoints for Owner dashboard KPIs and exports.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.db.database import get_db
from app.schemas.owner import (
    CompanyProfileResponse,
    KPIDashboardResponse,
    OwnerBusinessOverviewResponse,
    UpdateCompanyProfileRequest,
)
from app.services.audit_service import list_company_audit_logs, serialize_audit_log
from app.services import owner_service

router = APIRouter()


@router.get("/company-profile", response_model=CompanyProfileResponse)
def get_company_profile(
    current_user=Depends(require_roles("owner")),
    db: Session = Depends(get_db),
):
    """Get owner-manageable company profile details."""
    try:
        return owner_service.get_company_profile(db, current_user.company_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.patch("/company-profile", response_model=CompanyProfileResponse)
def update_company_profile(
    request: UpdateCompanyProfileRequest,
    current_user=Depends(require_roles("owner")),
    db: Session = Depends(get_db),
):
    """Update company profile metadata for the owner workspace."""
    try:
        return owner_service.update_company_profile(
            db,
            current_user.company_id,
            request,
            actor=current_user,
        )
    except ValueError as exc:
        detail = str(exc)
        status_code = 400 if "already exists" in detail else 404
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.get("/business-overview", response_model=OwnerBusinessOverviewResponse)
def get_business_overview(
    current_user=Depends(require_roles("owner")),
    db: Session = Depends(get_db),
):
    """Get owner business overview: company, subscription, usage, reports, and watchlist."""
    try:
        return owner_service.get_business_overview(db, current_user.company_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/audit-logs")
def get_audit_logs(
    limit: int = 50,
    current_user=Depends(require_roles("owner")),
    db: Session = Depends(get_db),
):
    """Get recent owner-facing audit history."""
    entries = list_company_audit_logs(db, current_user.company_id, limit=min(max(limit, 1), 200))
    return [serialize_audit_log(entry) for entry in entries]


@router.get("/kpi", response_model=KPIDashboardResponse)
def get_kpi_metrics(
    current_user=Depends(require_roles("owner")),
    db: Session = Depends(get_db)
):
    """Retrieve global KPIs for the owner dashboard."""
    return owner_service.get_kpi_dashboard(db, current_user.company_id)

@router.get("/export/csv", response_class=PlainTextResponse)
def export_csv(
    current_user=Depends(require_roles("owner", "supervisor")),
    db: Session = Depends(get_db)
):
    """Export tasks to CSV. Can be opened in Excel."""
    csv_str = owner_service.generate_task_csv(db, current_user.company_id)
    return PlainTextResponse(
        content=csv_str,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=mechtrack_export.csv"}
    )

@router.get("/export/pdf")
def export_pdf(
    current_user=Depends(require_roles("owner", "supervisor")),
    db: Session = Depends(get_db)
):
    """Export tasks to PDF."""
    pdf_buffer = owner_service.generate_task_pdf(db, current_user.company_id)
    return StreamingResponse(
        pdf_buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=mechtrack_report.pdf"}
    )
