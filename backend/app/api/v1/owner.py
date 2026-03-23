"""
MechTrack Pulse — Owner API Router

Endpoints for Owner dashboard KPIs and exports.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse, PlainTextResponse
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.db.database import get_db
from app.schemas.owner import KPIDashboardResponse
from app.services import owner_service

router = APIRouter()

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
