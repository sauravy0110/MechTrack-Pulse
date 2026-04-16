"""
MechTrack Pulse — Job Processes API Routes (CNC Process Plan)

Endpoints:
  POST /api/v1/job-processes/{task_id}/suggest    → AI suggest process plan
  POST /api/v1/job-processes/{task_id}/validate   → AI validate existing plan
  POST /api/v1/job-processes/{task_id}/add        → Add an operation step
  GET  /api/v1/job-processes/{task_id}            → List all operations
  PATCH /api/v1/job-processes/op/{op_id}          → Update an operation
  DELETE /api/v1/job-processes/op/{op_id}         → Delete an operation
  POST /api/v1/job-processes/{task_id}/lock       → Lock process plan
  POST /api/v1/job-processes/{task_id}/reorder    → Reorder operations
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles, require_password_changed
from app.db.database import get_db
from app.models.job_process import JobProcess
from app.models.task import Task
from app.models.user import User
from app.services.cnc_ai_service import suggest_process_plan, validate_process_plan

router = APIRouter()


# ── Schemas ──────────────────────────────────────────────────

class AddOperationRequest(BaseModel):
    operation_name: str = Field(..., min_length=2, max_length=200)
    machine_id: str | None = None
    tool_required: str | None = Field(None, max_length=200)
    cycle_time_minutes: int | None = Field(None, ge=1, le=10000)
    sequence_order: int = Field(1, ge=1)
    notes: str | None = Field(None, max_length=500)


class UpdateOperationRequest(BaseModel):
    operation_name: str | None = Field(None, min_length=2, max_length=200)
    machine_id: str | None = None
    tool_required: str | None = Field(None, max_length=200)
    cycle_time_minutes: int | None = Field(None, ge=1, le=10000)
    sequence_order: int | None = Field(None, ge=1)
    notes: str | None = Field(None, max_length=500)


class ReorderRequest(BaseModel):
    operation_ids: list[str] = Field(..., description="List of op IDs in desired order")


def _op_to_dict(op: JobProcess) -> dict:
    return {
        "id": str(op.id),
        "task_id": str(op.task_id),
        "operation_name": op.operation_name,
        "machine_id": str(op.machine_id) if op.machine_id else None,
        "machine_name": op.machine.name if op.machine else None,
        "tool_required": op.tool_required,
        "cycle_time_minutes": op.cycle_time_minutes,
        "sequence_order": op.sequence_order,
        "notes": op.notes,
        "is_ai_suggested": op.is_ai_suggested,
        "is_locked": op.is_locked,
        "created_at": op.created_at.isoformat(),
    }


def _get_scoped_task(db: Session, task_id: UUID, company_id: UUID) -> Task:
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Job not found")
    return task


# ── GET /job-processes/{task_id} ─────────────────────────────

@router.get("/{task_id}", status_code=status.HTTP_200_OK)
def list_processes(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """List all operations in the process plan. All roles can view."""
    task = _get_scoped_task(db, task_id, current_user.company_id)

    if current_user.role == "client" and task.client_id != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")

    ops = db.query(JobProcess).filter(
        JobProcess.task_id == task_id,
        JobProcess.company_id == current_user.company_id,
    ).order_by(JobProcess.sequence_order).all()

    total_time = sum(op.cycle_time_minutes or 0 for op in ops)

    return {
        "task_id": str(task_id),
        "operation_count": len(ops),
        "total_cycle_time_minutes": total_time,
        "operations": [_op_to_dict(op) for op in ops],
    }


# ── POST /job-processes/{task_id}/suggest ───────────────────

@router.post("/{task_id}/suggest", status_code=status.HTTP_200_OK)
def ai_suggest_process(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    AI-generated process plan suggestion.
    Deletes existing AI-suggested ops and creates fresh suggestions.
    Supervisor must review and may edit before locking.
    """
    task = _get_scoped_task(db, task_id, current_user.company_id)

    if task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — process plan cannot be changed")

    # Remove previous AI-suggested ops (keep manual ones)
    db.query(JobProcess).filter(
        JobProcess.task_id == task_id,
        JobProcess.company_id == current_user.company_id,
        JobProcess.is_ai_suggested == True,
    ).delete()

    result = suggest_process_plan(db, current_user.company_id, task_id)

    if result.get("status") == "error":
        raise HTTPException(status_code=400, detail=result.get("message", "AI suggestion failed"))

    # Save suggested operations
    saved_ops = []
    for op_data in result.get("operations", []):
        machine_id = None
        if op_data.get("machine_id"):
            from uuid import UUID as _UUID
            try:
                machine_id = _UUID(op_data["machine_id"])
            except Exception:
                machine_id = None

        op = JobProcess(
            company_id=current_user.company_id,
            task_id=task_id,
            operation_name=op_data["operation_name"],
            machine_id=machine_id,
            tool_required=op_data.get("tool_required") or None,
            cycle_time_minutes=op_data.get("cycle_time_minutes"),
            sequence_order=op_data["sequence_order"],
            notes=op_data.get("notes") or None,
            is_ai_suggested=True,
            is_locked=False,
        )
        db.add(op)
        saved_ops.append(op)

    db.commit()

    # Refresh for machine relationships
    for op in saved_ops:
        db.refresh(op)

    return {
        "status": result["status"],
        "source": result.get("source"),
        "confidence": result.get("confidence"),
        "message": result.get("message"),
        "suggestion": result.get("suggestion"),
        "operations": [_op_to_dict(op) for op in saved_ops],
    }


# ── POST /job-processes/{task_id}/validate ──────────────────

@router.post("/{task_id}/validate", status_code=status.HTTP_200_OK)
def ai_validate_process(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """AI validates the current process plan for completeness and sequence correctness."""
    _get_scoped_task(db, task_id, current_user.company_id)
    return validate_process_plan(db, current_user.company_id, task_id)


# ── POST /job-processes/{task_id}/add ───────────────────────

@router.post("/{task_id}/add", status_code=status.HTTP_201_CREATED)
def add_operation(
    task_id: UUID,
    request: AddOperationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Manually add an operation to the process plan."""
    task = _get_scoped_task(db, task_id, current_user.company_id)

    if task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — cannot add operations")

    machine_id = None
    if request.machine_id:
        from uuid import UUID as _UUID
        try:
            machine_id = _UUID(request.machine_id)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid machine_id format")

    op = JobProcess(
        company_id=current_user.company_id,
        task_id=task_id,
        operation_name=request.operation_name,
        machine_id=machine_id,
        tool_required=request.tool_required,
        cycle_time_minutes=request.cycle_time_minutes,
        sequence_order=request.sequence_order,
        notes=request.notes,
        is_ai_suggested=False,
        is_locked=False,
    )
    db.add(op)
    db.commit()
    db.refresh(op)
    return _op_to_dict(op)


# ── PATCH /job-processes/op/{op_id} ─────────────────────────

@router.patch("/op/{op_id}", status_code=status.HTTP_200_OK)
def update_operation(
    op_id: UUID,
    request: UpdateOperationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Update an existing operation step."""
    op = db.query(JobProcess).filter(
        JobProcess.id == op_id,
        JobProcess.company_id == current_user.company_id,
    ).first()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")

    task = db.query(Task).filter(Task.id == op.task_id).first()
    if task and task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — cannot edit operations")

    if request.operation_name is not None:
        op.operation_name = request.operation_name
    if request.tool_required is not None:
        op.tool_required = request.tool_required or None
    if request.cycle_time_minutes is not None:
        op.cycle_time_minutes = request.cycle_time_minutes
    if request.sequence_order is not None:
        op.sequence_order = request.sequence_order
    if request.notes is not None:
        op.notes = request.notes or None
    if request.machine_id is not None:
        if request.machine_id == "":
            op.machine_id = None
        else:
            from uuid import UUID as _UUID
            try:
                op.machine_id = _UUID(request.machine_id)
            except Exception:
                raise HTTPException(status_code=400, detail="Invalid machine_id format")

    # Mark as manually edited (no longer pure AI)
    if op.is_ai_suggested:
        op.is_ai_suggested = False

    db.commit()
    db.refresh(op)
    return _op_to_dict(op)


# ── DELETE /job-processes/op/{op_id} ─────────────────────────

@router.delete("/op/{op_id}", status_code=status.HTTP_200_OK)
def delete_operation(
    op_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Remove an operation from the process plan."""
    op = db.query(JobProcess).filter(
        JobProcess.id == op_id,
        JobProcess.company_id == current_user.company_id,
    ).first()
    if not op:
        raise HTTPException(status_code=404, detail="Operation not found")

    task = db.query(Task).filter(Task.id == op.task_id).first()
    if task and task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — cannot delete operations")

    db.delete(op)
    db.commit()
    return {"message": "Operation deleted", "op_id": str(op_id)}


# ── POST /job-processes/{task_id}/lock ──────────────────────

@router.post("/{task_id}/lock", status_code=status.HTTP_200_OK)
def lock_process_plan(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    Lock the process plan. Sets is_locked=True on all operations.
    Job status advances to 'planned'.
    """
    task = _get_scoped_task(db, task_id, current_user.company_id)

    ops = db.query(JobProcess).filter(
        JobProcess.task_id == task_id,
        JobProcess.company_id == current_user.company_id,
    ).all()

    if not ops:
        raise HTTPException(status_code=400, detail="No operations defined. Cannot lock empty process plan.")

    for op in ops:
        op.is_locked = True

    # Advance job status
    if task.status == "created":
        task.status = "planned"

    db.commit()

    return {
        "message": f"Process plan locked with {len(ops)} operations. Job status → planned.",
        "task_id": str(task_id),
        "status": task.status,
        "operation_count": len(ops),
    }


# ── POST /job-processes/{task_id}/reorder ───────────────────

@router.post("/{task_id}/reorder", status_code=status.HTTP_200_OK)
def reorder_operations(
    task_id: UUID,
    request: ReorderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Reorder operations by providing the list of IDs in desired sequence."""
    task = _get_scoped_task(db, task_id, current_user.company_id)

    if task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — cannot reorder operations")

    ops = db.query(JobProcess).filter(
        JobProcess.task_id == task_id,
        JobProcess.company_id == current_user.company_id,
    ).all()
    ops_by_id = {str(op.id): op for op in ops}

    for idx, op_id in enumerate(request.operation_ids):
        if op_id in ops_by_id:
            ops_by_id[op_id].sequence_order = idx + 1

    db.commit()

    updated_ops = db.query(JobProcess).filter(
        JobProcess.task_id == task_id,
        JobProcess.company_id == current_user.company_id,
    ).order_by(JobProcess.sequence_order).all()

    return {
        "message": "Operations reordered successfully.",
        "operations": [_op_to_dict(op) for op in updated_ops],
    }
