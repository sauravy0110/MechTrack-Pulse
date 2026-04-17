"""
MechTrack Pulse — Operator API Router

Endpoints for operator duty management and status views.
"""

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.core.dependencies import require_password_changed, require_roles
from app.db.database import get_db
from app.services import operator_service
from app.api.v1.websocket import broadcast_operator_update

router = APIRouter()


# ── Toggle Duty ──────────────────────────────────────────────

@router.post("/toggle-duty")
async def toggle_duty(
    background_tasks: BackgroundTasks,
    current_user=Depends(require_roles("operator")),
    db: Session = Depends(get_db),
):
    """
    Toggle operator on/off duty.
    Only operators can toggle their own duty status.
    """
    updated = operator_service.toggle_duty(db, current_user)

    # Broadcast to all connected clients
    background_tasks.add_task(
        broadcast_operator_update,
        current_user.company_id,
        operator_service.build_operator_payload(db, current_user.company_id, updated),
    )

    return {
        "is_on_duty": updated.is_on_duty,
        "last_active_at": str(updated.last_active_at),
        "message": "On duty" if updated.is_on_duty else "Off duty",
    }


# ── Get Operator Status List ────────────────────────────────

@router.get("/status")
def get_operator_status(
    current_user=Depends(require_roles("owner", "supervisor", "operator")),
    db: Session = Depends(get_db),
):
    """
    Get all operators in the company with their duty/task status.
    Available to all authenticated users.
    """
    operators = operator_service.get_operators(db, current_user.company_id)
    return [
        operator_service.build_operator_payload(db, current_user.company_id, op)
        for op in operators
    ]
