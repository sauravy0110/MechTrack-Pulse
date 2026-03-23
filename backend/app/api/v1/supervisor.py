"""
MechTrack Pulse — Supervisor Router

Endpoints for Shift definition and Alert configurations.
Only Accessible by Supervisors / Owners.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.db.database import get_db
from app.schemas.supervisor import (
    ShiftCreate, ShiftResponse,
    AlertConfigCreate, AlertConfigResponse
)
from app.services import supervisor_service

router = APIRouter()

# ── Shifts ───────────────────────────────────────────────────

@router.post("/shifts", response_model=ShiftResponse)
def create_shift(
    schema: ShiftCreate,
    current_user=Depends(require_roles("supervisor", "owner")),
    db: Session = Depends(get_db)
):
    """Create a working shift."""
    return supervisor_service.create_shift(db, current_user.company_id, schema)

@router.get("/shifts", response_model=list[ShiftResponse])
def get_shifts(
    current_user=Depends(require_roles("supervisor", "owner", "operator")),
    db: Session = Depends(get_db)
):
    """List all shifts for the company."""
    return supervisor_service.get_shifts(db, current_user.company_id)


# ── Alert Config ─────────────────────────────────────────────

@router.post("/alerts/config", response_model=AlertConfigResponse)
def configure_alert(
    schema: AlertConfigCreate,
    current_user=Depends(require_roles("supervisor", "owner")),
    db: Session = Depends(get_db)
):
    """Create or update an alert configuration (upsert)."""
    return supervisor_service.upsert_alert_config(db, current_user.company_id, schema)

@router.get("/alerts/config", response_model=list[AlertConfigResponse])
def get_alert_configs(
    current_user=Depends(require_roles("supervisor", "owner")),
    db: Session = Depends(get_db)
):
    """List configured alerts."""
    return supervisor_service.get_alert_configs(db, current_user.company_id)
