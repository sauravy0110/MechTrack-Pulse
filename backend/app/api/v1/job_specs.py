"""
MechTrack Pulse — Job Specs API Routes (CNC Drawing Specifications)

Endpoints:
  POST /api/v1/job-specs/{task_id}/extract   → AI extract specs from drawing context
  GET  /api/v1/job-specs/{task_id}           → List all specs for a job
  PATCH /api/v1/job-specs/{spec_id}          → Update human_value for a spec
  POST /api/v1/job-specs/{task_id}/confirm-all → Confirm all specs (supervisor verification)
  DELETE /api/v1/job-specs/{spec_id}         → Remove a spec row
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles, require_password_changed
from app.db.database import get_db
from app.models.job_spec import JobSpec
from app.models.task import Task
from app.models.user import User
from app.services.cnc_ai_service import extract_drawing_specs

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────

class ExtractSpecsRequest(BaseModel):
    drawing_context: str | None = Field(
        None,
        max_length=3000,
        description="Text description/OCR output of drawing content for AI extraction",
    )
    drawing_image_url: str | None = Field(
        None,
        max_length=2000,
        description="Absolute image URL for uploaded drawing when vision OCR is available",
    )
    part_name: str | None = Field(None, max_length=200)


class UpdateSpecRequest(BaseModel):
    human_value: str | None = Field(None, max_length=200)
    is_confirmed: bool | None = None


class AddSpecRequest(BaseModel):
    field_name: str = Field(..., min_length=1, max_length=100)
    ai_value: str | None = Field(None, max_length=200)
    human_value: str | None = Field(None, max_length=200)
    unit: str | None = Field(None, max_length=20)
    ai_confidence: float | None = Field(None, ge=0.0, le=1.0)


def _review_status_from_confidence(ai_confidence: float | None) -> str:
    confidence_value = float(ai_confidence or 0.0)
    if confidence_value >= 0.9:
        return "high_confidence"
    if confidence_value >= 0.7:
        return "needs_review"
    return "invalid"


def _spec_to_dict(spec: JobSpec) -> dict:
    review_status = _review_status_from_confidence(spec.ai_confidence)
    return {
        "id": str(spec.id),
        "task_id": str(spec.task_id),
        "field_name": spec.field_name,
        "ai_value": spec.ai_value,
        "ai_confidence": spec.ai_confidence,
        "review_status": review_status,
        "requires_human_value": review_status == "invalid",
        "human_value": spec.human_value,
        "unit": spec.unit,
        "is_confirmed": spec.is_confirmed,
        "confirmed_value": spec.human_value if spec.is_confirmed else spec.ai_value,
        "created_at": spec.created_at.isoformat(),
        "updated_at": spec.updated_at.isoformat(),
    }


def _get_scoped_task(db: Session, task_id: UUID, company_id: UUID) -> Task:
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Job not found")
    return task


# ── POST /job-specs/{task_id}/extract ───────────────────────

@router.post("/{task_id}/extract", status_code=status.HTTP_200_OK)
def extract_specs_route(
    task_id: UUID,
    request: ExtractSpecsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    Trigger AI extraction of drawing specifications.
    Creates/replaces JobSpec rows for the given task.
    Supervisor must be role owner or supervisor.
    """
    task = _get_scoped_task(db, task_id, current_user.company_id)

    if task.is_locked:
        raise HTTPException(
            status_code=400,
            detail="Job is locked — specs cannot be re-extracted after locking."
        )

    result = extract_drawing_specs(
        db=db,
        company_id=current_user.company_id,
        task_id=task_id,
        part_name=request.part_name,
        drawing_context=request.drawing_context,
        drawing_image_url=request.drawing_image_url,
    )

    # Refresh to get newly created specs
    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == current_user.company_id,
    ).all()

    result["specs"] = [_spec_to_dict(s) for s in specs]
    return result


# ── GET /job-specs/{task_id} ─────────────────────────────────

@router.get("/{task_id}", status_code=status.HTTP_200_OK)
def list_job_specs(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """List all specs for a job. All roles can view."""
    task = _get_scoped_task(db, task_id, current_user.company_id)

    # Client can only see their own jobs
    if current_user.role == "client" and task.client_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == current_user.company_id,
    ).all()

    all_confirmed = len(specs) > 0 and all(s.is_confirmed for s in specs)

    return {
        "task_id": str(task_id),
        "is_locked": task.is_locked,
        "all_confirmed": all_confirmed,
        "specs": [_spec_to_dict(s) for s in specs],
    }


# ── PATCH /job-specs/spec/{spec_id} ─────────────────────────

@router.patch("/spec/{spec_id}", status_code=status.HTTP_200_OK)
def update_spec_route(
    spec_id: UUID,
    request: UpdateSpecRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Update human_value and/or confirmation status for a single spec."""
    spec = db.query(JobSpec).filter(
        JobSpec.id == spec_id,
        JobSpec.company_id == current_user.company_id,
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    # Check task lock
    task = db.query(Task).filter(Task.id == spec.task_id).first()
    if task and task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — specs cannot be edited")

    if request.human_value is not None:
        spec.human_value = request.human_value
    if request.is_confirmed is not None:
        spec.is_confirmed = request.is_confirmed

    db.commit()
    db.refresh(spec)
    return _spec_to_dict(spec)


# ── POST /job-specs/{task_id}/confirm-all ───────────────────

@router.post("/{task_id}/confirm-all", status_code=status.HTTP_200_OK)
def confirm_all_specs(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    Mark all specs as confirmed (supervisor verification step).
    Sets is_confirmed=True on all specs that have a human_value or ai_value.
    """
    task = _get_scoped_task(db, task_id, current_user.company_id)

    if task.is_locked:
        raise HTTPException(status_code=400, detail="Job is already locked")

    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == current_user.company_id,
    ).all()

    if not specs:
        raise HTTPException(status_code=400, detail="No specs to confirm. Extract specs first.")

    blocking_specs = [
        spec.field_name.replace("_", " ")
        for spec in specs
        if _review_status_from_confidence(spec.ai_confidence) == "invalid"
        and not (spec.human_value and spec.human_value.strip())
    ]
    if blocking_specs:
        raise HTTPException(
            status_code=400,
            detail=(
                "These low-confidence specs need a typed human value before confirmation: "
                + ", ".join(blocking_specs)
            ),
        )

    for spec in specs:
        spec.is_confirmed = True
        # If no human value was set, copy AI value as confirmed value
        if not spec.human_value and spec.ai_value:
            spec.human_value = spec.ai_value

    db.commit()

    return {
        "message": f"All {len(specs)} specs confirmed. You can now lock the job.",
        "specs_confirmed": len(specs),
        "task_id": str(task_id),
    }


# ── POST /job-specs/{task_id}/add ────────────────────────────

@router.post("/{task_id}/add", status_code=status.HTTP_201_CREATED)
def add_spec_manually(
    task_id: UUID,
    request: AddSpecRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Manually add a custom specification row."""
    task = _get_scoped_task(db, task_id, current_user.company_id)

    if task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — cannot add specs")

    spec = JobSpec(
        company_id=current_user.company_id,
        task_id=task_id,
        field_name=request.field_name,
        ai_value=request.ai_value,
        human_value=request.human_value,
        unit=request.unit or "mm",
        ai_confidence=request.ai_confidence,
        is_confirmed=bool(request.human_value),
    )
    db.add(spec)
    db.commit()
    db.refresh(spec)
    return _spec_to_dict(spec)


# ── DELETE /job-specs/spec/{spec_id} ─────────────────────────

@router.delete("/spec/{spec_id}", status_code=status.HTTP_200_OK)
def delete_spec_route(
    spec_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Delete a manual spec row (only if job is not locked)."""
    spec = db.query(JobSpec).filter(
        JobSpec.id == spec_id,
        JobSpec.company_id == current_user.company_id,
    ).first()
    if not spec:
        raise HTTPException(status_code=404, detail="Spec not found")

    task = db.query(Task).filter(Task.id == spec.task_id).first()
    if task and task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — cannot delete specs")

    db.delete(spec)
    db.commit()
    return {"message": "Spec deleted", "spec_id": str(spec_id)}
