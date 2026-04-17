"""
MechTrack Pulse — Task Management API Routes

Endpoints:
  POST   /api/v1/tasks/                    → Create task (owner/supervisor)
  GET    /api/v1/tasks/                    → List tasks
  GET    /api/v1/tasks/{id}                → Get task detail
  PATCH  /api/v1/tasks/{id}                → Update task
  PATCH  /api/v1/tasks/{id}/status         → Update task status
  PATCH  /api/v1/tasks/{id}/assign         → Assign task
  GET    /api/v1/tasks/{id}/logs           → Get task logs
  POST   /api/v1/tasks/{id}/lock           → Lock CNC job specs [CNC]
  POST   /api/v1/tasks/{id}/rework         → Trigger rework loop [CNC]
  PATCH  /api/v1/tasks/{id}/cnc-fields     → Update CNC fields [CNC]
  GET    /api/v1/tasks/queue               → View unassigned queue
  POST   /api/v1/tasks/queue/next          → Dequeue next task

ROLES:
  - Owner/Supervisor: full access
  - Operator: can only update own tasks' status
  - Client: read-only
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.core.dependencies import RequirePermission, require_password_changed
from app.core.permissions import Permission
from app.db.database import get_db
from app.models.user import User
from app.schemas.task import (
    AssignTaskRequest,
    CreateTaskRequest,
    TaskLogResponse,
    TaskNoteRequest,
    TaskNoteResponse,
    TaskResponse,
    UpdateTaskRequest,
)
from app.services.audit_service import record_audit_log
from app.services.task_service import (
    add_task_note,
    assign_task,
    create_task,
    delete_task,
    get_task,
    get_task_logs,
    list_tasks,
    update_task,
    update_task_status,
    user_can_access_task,
)
from pydantic import BaseModel, Field
from app.models.task import Task
from app.models.job_spec import JobSpec
from app.models.job_process import JobProcess
from app.models.task_image import TaskImage
from app.models.machine import Machine
from app.models.client import Client
from app.models.assignment import Assignment
from app.models.production_log import ProductionLog
from app.models.qc_report import QCReport
from app.models.ai_report import AIReport
from app.models.rework_log import ReworkLog
from app.models.dispatch_record import DispatchRecord
from app.services.cnc_ai_service import get_rework_suggestion, analyze_setup_image, analyze_final_inspection
from app.services.task_queue import dequeue_task, peek_queue, queue_size
from app.services.ai_action_engine import evaluate_operator_load
from app.services.operator_service import MAX_TASKS_PER_OPERATOR, find_best_operator
from app.core.dependencies import require_roles
from app.services.mes_service import (
    build_process_snapshot,
    build_spec_snapshot,
    create_job_version,
    get_production_totals,
    has_locked_process_plan,
    is_cnc_job,
    record_ai_report,
    record_assignment,
    record_rework,
)

router = APIRouter()

# ── CNC Pipeline status values ───────────────────────────────
CNC_STATUSES = {
    "idle", "queued", "in_progress", "paused", "completed", "delayed",
    "created", "planned", "ready", "assigned", "setup", "setup_done",
    "first_piece_approval", "qc_check", "final_inspection", "dispatched",
}


def _task_to_response(task) -> TaskResponse:
    """Helper to convert Task ORM object to response."""
    return TaskResponse(
        id=str(task.id),
        title=task.title,
        description=task.description,
        status=task.status,
        priority=task.priority,
        assigned_to=str(task.assigned_to) if task.assigned_to else None,
        client_id=str(task.client_id) if task.client_id else None,
        created_by=str(task.created_by),
        machine_id=str(task.machine_id) if task.machine_id else None,
        estimated_completion=task.estimated_completion,
        actual_completion=task.actual_completion,
        total_time_spent_seconds=task.total_time_spent_seconds,
        timer_started_at=task.timer_started_at,
        delay_reason=task.delay_reason,
        delay_probability=task.delay_probability,
        created_at=task.created_at,
        updated_at=task.updated_at,
        # CNC fields
        is_locked=bool(task.is_locked),
        rework_flag=bool(task.rework_flag),
        rework_iteration=task.rework_iteration or 0,
        part_name=task.part_name,
        material_type=task.material_type,
        material_batch=task.material_batch,
        operation_type=task.operation_type,
        operation_other=task.operation_other,
        drawing_url=task.drawing_url,
        rework_reason=task.rework_reason,
    )


def _operator_to_payload(operator: User) -> dict:
    if operator is None:
        return {}

    if not operator.is_on_duty:
        status = "offline"
    elif operator.current_task_count >= MAX_TASKS_PER_OPERATOR:
        status = "busy"
    else:
        status = "available"

    return {
        "id": str(operator.id),
        "full_name": operator.full_name,
        "email": operator.email,
        "is_on_duty": operator.is_on_duty,
        "current_task_count": operator.current_task_count,
        "last_active_at": operator.last_active_at,
        "status": status,
    }


def _broadcast_mes_task_update(
    background_tasks: BackgroundTasks | None,
    company_id: UUID,
    task: Task,
    *,
    message: str | None = None,
    severity: str = "info",
):
    if background_tasks is None:
        return
    from app.api.v1.websocket import broadcast_notification, broadcast_task_update

    background_tasks.add_task(
        broadcast_task_update,
        company_id,
        _task_to_response(task).model_dump(),
    )
    if message:
        background_tasks.add_task(
            broadcast_notification,
            company_id,
            message,
            severity,
        )


def _get_accessible_task_or_404(
    db: Session,
    company_id: UUID,
    current_user: User,
    task_id: UUID,
):
    task = get_task(db, company_id, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not user_can_access_task(task, current_user):
        raise HTTPException(status_code=403, detail="You do not have access to this task")
    return task


# ── Create Task ──────────────────────────────────────────────

@router.post("/", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task_route(
    request: CreateTaskRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.CREATE_TASK)),
):
    """Create a new task. Only owner/supervisor can create."""
    task, error = create_task(
        db=db,
        company_id=current_user.company_id,
        created_by=current_user.id,
        title=request.title,
        description=request.description,
        priority=request.priority,
        assigned_to=request.assigned_to,
        client_id=request.client_id,
        machine_id=request.machine_id,
        estimated_completion=request.estimated_completion,
    )
    if error:
        raise HTTPException(status_code=400, detail=error)
    
    # Broadcast to all connected users in company
    from app.api.v1.websocket import (
        broadcast_notification,
        broadcast_operator_update,
        broadcast_task_update,
    )
    resp = _task_to_response(task)
    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="task.created",
        resource_type="task",
        resource_id=task.id,
        details={
            "title": task.title,
            "priority": task.priority,
            "assigned_to": str(task.assigned_to) if task.assigned_to else None,
            "machine_id": str(task.machine_id) if task.machine_id else None,
        },
    )
    db.commit()
    background_tasks.add_task(broadcast_task_update, current_user.company_id, resp.model_dump())
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"Task '{task.title}' created with {task.priority} priority.",
        "info",
    )

    if task.assigned_to:
        operator = db.query(User).filter(User.id == task.assigned_to).first()
        if operator:
            background_tasks.add_task(
                broadcast_operator_update,
                current_user.company_id,
                _operator_to_payload(operator),
            )

    promoted_task = getattr(task, "_promoted_task", None)
    if promoted_task is not None:
        background_tasks.add_task(
            broadcast_task_update,
            current_user.company_id,
            _task_to_response(promoted_task).model_dump(),
        )
    
    # ── Trigger AI Load Evaluation ──
    background_tasks.add_task(evaluate_operator_load, current_user.company_id)
    
    return resp


# ── List Tasks ───────────────────────────────────────────────

@router.get("/", response_model=list[TaskResponse])
def list_tasks_route(
    status_filter: str | None = Query(None, alias="status"),
    priority: str | None = Query(None),
    assigned_to: UUID | None = Query(None),
    client_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """
    List tasks in the company.
    Operators only see their own tasks.
    """
    # Operators can only see their own tasks
    if current_user.role == "operator":
        assigned_to = current_user.id
    elif current_user.role == "client":
        client_id = current_user.id

    tasks = list_tasks(
        db=db,
        company_id=current_user.company_id,
        status_filter=status_filter,
        assigned_to=assigned_to,
        client_id=client_id,
        priority_filter=priority,
    )
    return [_task_to_response(t) for t in tasks]


# ── Get Task Detail ──────────────────────────────────────────

@router.get("/{task_id}", response_model=TaskResponse)
def get_task_route(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Get a specific task."""
    task = _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    return _task_to_response(task)


# ── Update Task ──────────────────────────────────────────────

@router.patch("/{task_id}", response_model=TaskResponse)
def update_task_route(
    task_id: UUID,
    request: UpdateTaskRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.UPDATE_TASK)),
):
    """Update task details. Owner/supervisor only."""
    updates = request.model_dump(exclude_unset=True)
    task, error = update_task(db, current_user.company_id, task_id, current_user.id, updates)
    if error:
        raise HTTPException(status_code=400, detail=error)
    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="task.updated",
        resource_type="task",
        resource_id=task.id,
        details={"fields": list(updates.keys())},
    )
    db.commit()
    return _task_to_response(task)


# ── Delete Task ──────────────────────────────────────────────

@router.delete("/{task_id}", status_code=status.HTTP_200_OK)
async def delete_task_route(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.DELETE_TASK)),
):
    """Permanently delete a task and all its related data. Owner/supervisor only."""
    # Capture title for notification before deletion
    task = get_task(db, current_user.company_id, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    task_title = task.title

    success, error = delete_task(db, current_user.company_id, task_id, current_user.id)
    if not success:
        raise HTTPException(status_code=400, detail=error)

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="task.deleted",
        resource_type="task",
        resource_id=task_id,
        details={"title": task_title},
    )
    db.commit()

    from app.api.v1.websocket import broadcast_task_deleted, broadcast_notification
    background_tasks.add_task(broadcast_task_deleted, current_user.company_id, str(task_id))
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"Task '{task_title}' was deleted.",
        "info",
    )
    return {"detail": f"Task '{task_title}' deleted successfully"}


# ── Update Task Status ──────────────────────────────────────

@router.patch("/{task_id}/status", response_model=TaskResponse)
async def update_task_status_route(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    new_status: str = Query(..., description="New status value — general or CNC stage"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """
    Update task status with transition validation.
    Operators can update their own tasks only.
    """
    if current_user.role == "client":
        raise HTTPException(status_code=403, detail="Clients cannot update task status")

    # Operators: only their own tasks
    if current_user.role == "operator":
        task = get_task(db, current_user.company_id, task_id)
        if not task or task.assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="You can only update your own tasks")

    previous_task = get_task(db, current_user.company_id, task_id)
    previous_status = previous_task.status if previous_task else None
    task, error = update_task_status(db, current_user.company_id, task_id, new_status, current_user.id)
    if error:
        raise HTTPException(status_code=400, detail=error)
        
    # Broadcast update
    from app.api.v1.websocket import (
        broadcast_notification,
        broadcast_operator_update,
        broadcast_task_update,
    )
    resp = _task_to_response(task)
    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action=f"task.status.{new_status}",
        resource_type="task",
        resource_id=task.id,
        details={"previous_status": previous_status, "new_status": new_status},
    )
    db.commit()
    background_tasks.add_task(broadcast_task_update, current_user.company_id, resp.model_dump())
    if new_status in {"delayed", "completed", "in_progress"}:
        severity = "warning" if new_status == "delayed" else "success" if new_status == "completed" else "info"
        background_tasks.add_task(
            broadcast_notification,
            current_user.company_id,
            f"Task '{task.title}' moved to {new_status.replace('_', ' ')}.",
            severity,
        )

    if task.assigned_to:
        operator = db.query(User).filter(User.id == task.assigned_to).first()
        if operator:
            background_tasks.add_task(
                broadcast_operator_update,
                current_user.company_id,
                _operator_to_payload(operator),
            )
    
    # ── Trigger AI Load Evaluation ──
    if new_status in ["in_progress", "idle", "queued"]:
        background_tasks.add_task(evaluate_operator_load, current_user.company_id)
    
    return resp


# ── Assign Task ──────────────────────────────────────────────

@router.patch("/{task_id}/assign", response_model=TaskResponse)
async def assign_task_route(
    task_id: UUID,
    request: AssignTaskRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.ASSIGN_TASK)),
):
    """Assign or reassign a task to a user."""
    old_task = get_task(db, current_user.company_id, task_id)
    if old_task and is_cnc_job(old_task):
        allowed_assignment_statuses = {"ready", "assigned", "setup", "setup_done", "first_piece_approval", "in_progress", "qc_check", "final_inspection"}
        if old_task.status not in allowed_assignment_statuses and not old_task.rework_flag:
            raise HTTPException(status_code=400, detail="CNC jobs can be assigned only after material validation is complete")
    old_assignee_id = old_task.assigned_to if old_task else None
    task, error = assign_task(
        db, current_user.company_id, task_id, request.assigned_to, current_user.id
    )
    if error:
        raise HTTPException(status_code=400, detail=error)
        
    # Broadcast update
    from app.api.v1.websocket import (
        broadcast_notification,
        broadcast_operator_update,
        broadcast_task_update,
    )
    resp = _task_to_response(task)
    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="task.assigned",
        resource_type="task",
        resource_id=task.id,
        details={
            "assigned_to": str(request.assigned_to),
            "previous_assignee": str(old_assignee_id) if old_assignee_id else None,
        },
    )
    db.commit()
    background_tasks.add_task(broadcast_task_update, current_user.company_id, resp.model_dump())
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"Task '{task.title}' assigned to a new operator.",
        "info",
    )

    affected_operator_ids = {request.assigned_to}
    if old_assignee_id:
        affected_operator_ids.add(old_assignee_id)

    for operator_id in affected_operator_ids:
        operator = db.query(User).filter(User.id == operator_id).first()
        if operator:
            background_tasks.add_task(
                broadcast_operator_update,
                current_user.company_id,
                _operator_to_payload(operator),
            )
    
    # ── Trigger AI Load Evaluation ──
    background_tasks.add_task(evaluate_operator_load, current_user.company_id)
    
    return resp


# ── Task Logs ────────────────────────────────────────────────

@router.get("/{task_id}/logs", response_model=list[TaskLogResponse])
def get_task_logs_route(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Get audit trail for a task."""
    _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    logs = get_task_logs(db, current_user.company_id, task_id)
    return [
        TaskLogResponse(
            id=str(log.id),
            action=log.action,
            previous_value=log.previous_value,
            new_value=log.new_value,
            details=log.details,
            user_id=str(log.user_id),
            created_at=log.created_at,
        )
        for log in logs
    ]


@router.post("/{task_id}/notes", response_model=TaskNoteResponse, status_code=status.HTTP_201_CREATED)
async def add_task_note_route(
    task_id: UUID,
    request: TaskNoteRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Add a note to a task for updates, blockers, and client communication."""
    task = _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    note_entry, error = add_task_note(
        db,
        current_user.company_id,
        task_id,
        current_user,
        request.note,
    )
    if error or not note_entry:
        raise HTTPException(status_code=400, detail=error or "Unable to add note")

    from app.api.v1.websocket import broadcast_notification

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="task.note_added",
        resource_type="task",
        resource_id=task.id,
        details={"note_preview": request.note[:120]},
    )
    db.commit()
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"{current_user.full_name} added a note on '{task.title}'.",
        "info",
    )
    return TaskNoteResponse(
        id=str(note_entry.id),
        task_id=str(task.id),
        note=note_entry.details or "",
        user_id=str(note_entry.user_id),
        created_at=note_entry.created_at,
    )


@router.get("/{task_id}/mes-summary", status_code=status.HTTP_200_OK)
def get_mes_summary_route(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Aggregated MES state for supervisor/operator/client dashboards."""
    task = _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    return _build_mes_summary(db, current_user.company_id, task)


# ── Task Queue ───────────────────────────────────────────────

@router.get("/queue/view")
def view_queue_route(
    current_user: User = Depends(RequirePermission(Permission.ASSIGN_TASK)),
):
    """View unassigned tasks in the queue."""
    tasks = peek_queue(current_user.company_id)
    return {
        "queue_size": queue_size(current_user.company_id),
        "task_ids": [str(t) for t in tasks],
    }


@router.post("/queue/next", response_model=TaskResponse | None)
def dequeue_next_route(
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.ASSIGN_TASK)),
):
    """Dequeue the next unassigned task from the queue."""
    task_id = dequeue_task(current_user.company_id)
    if not task_id:
        raise HTTPException(status_code=404, detail="No tasks in queue")

    task = get_task(db, current_user.company_id, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task no longer exists")

    return _task_to_response(task)


# ═══════════════════════════════════════════════════════════
# CNC-SPECIFIC ENDPOINTS
# ═══════════════════════════════════════════════════════════


class CNCFieldsRequest(BaseModel):
    part_name: str | None = None
    material_type: str | None = None
    material_batch: str | None = None
    operation_type: str | None = Field(None, max_length=100)
    operation_other: str | None = Field(None, max_length=255)
    drawing_url: str | None = None


class ReworkRequest(BaseModel):
    rework_reason: str | None = None
    reassign_to: str | None = None  # operator user_id


class MaterialValidationRequest(BaseModel):
    material_type: str | None = Field(None, max_length=100)
    material_batch: str | None = Field(None, max_length=100)


class MESAssignmentRequest(BaseModel):
    assigned_to: UUID | None = None
    machine_id: UUID | None = None
    notes: str | None = Field(None, max_length=500)
    use_ai_recommendation: bool = False


class FirstPieceRequest(BaseModel):
    qc_status: str = Field(..., pattern="^(pass|fail)$")
    measurements: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = Field(None, max_length=1000)


class ProductionLogRequest(BaseModel):
    produced_qty: int = Field(0, ge=0)
    rejected_qty: int = Field(0, ge=0)
    downtime_minutes: int = Field(0, ge=0)
    notes: str | None = Field(None, max_length=1000)


class QCStageReportRequest(BaseModel):
    qc_status: str = Field(..., pattern="^(pass|fail|rework)$")
    measurements: dict[str, Any] = Field(default_factory=dict)
    remarks: str | None = Field(None, max_length=1000)


class SupervisorFinalDecisionRequest(BaseModel):
    decision: str = Field(..., pattern="^(approve|rework)$")
    remarks: str | None = Field(None, max_length=1000)


class DispatchRequest(BaseModel):
    packing_details: str | None = Field(None, max_length=1000)
    invoice_number: str | None = Field(None, max_length=120)
    transport_details: str | None = Field(None, max_length=1000)


def _get_scoped_task(db: Session, company_id: UUID, task_id: UUID) -> Task:
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Job not found")
    return task


def _latest_media_url(db: Session, task_id: UUID) -> str | None:
    media = (
        db.query(TaskImage)
        .filter(TaskImage.task_id == task_id)
        .order_by(TaskImage.uploaded_at.desc())
        .first()
    )
    return media.image_url if media else None


def _client_payload_for_task(db: Session, company_id: UUID, task: Task) -> dict | None:
    if not task.client_id:
        return None
    profile = (
        db.query(Client)
        .filter(
            Client.company_id == company_id,
            Client.user_id == task.client_id,
        )
        .first()
    )
    if not profile:
        return None
    return {
        "client_id": profile.client_code,
        "company_name": profile.company_name,
        "contact_person": profile.contact_person,
        "address": profile.address,
        "username": profile.user.email if profile.user else None,
        "email": profile.user.email if profile.user else None,
    }


def _serialize_assignment(item: Assignment | None) -> dict | None:
    if not item:
        return None
    return {
        "id": str(item.id),
        "operator_id": str(item.operator_id) if item.operator_id else None,
        "machine_id": str(item.machine_id) if item.machine_id else None,
        "assignment_type": item.assignment_type,
        "ai_recommended": item.ai_recommended,
        "notes": item.notes,
        "created_at": item.created_at.isoformat(),
    }


def _serialize_qc_report(item: QCReport | None) -> dict | None:
    if not item:
        return None
    return {
        "id": str(item.id),
        "stage": item.stage,
        "qc_status": item.qc_status,
        "measured_values": item.measured_values or {},
        "remarks": item.remarks,
        "created_at": item.created_at.isoformat(),
    }


def _serialize_ai_report(item: AIReport | None) -> dict | None:
    if not item:
        return None
    return {
        "id": str(item.id),
        "stage": item.stage,
        "status": item.status,
        "confidence": item.confidence,
        "suggestion": item.suggestion,
        "decision": item.decision,
        "payload": item.payload or {},
        "created_at": item.created_at.isoformat(),
    }


def _serialize_dispatch(item: DispatchRecord | None) -> dict | None:
    if not item:
        return None
    return {
        "id": str(item.id),
        "packing_details": item.packing_details,
        "invoice_number": item.invoice_number,
        "transport_details": item.transport_details,
        "created_at": item.created_at.isoformat(),
    }


def _build_mes_summary(db: Session, company_id: UUID, task: Task) -> dict:
    latest_assignment = (
        db.query(Assignment)
        .filter(Assignment.company_id == company_id, Assignment.task_id == task.id)
        .order_by(Assignment.created_at.desc())
        .first()
    )
    material_validation = (
        db.query(AIReport)
        .filter(
            AIReport.company_id == company_id,
            AIReport.task_id == task.id,
            AIReport.stage == "material_validation",
        )
        .order_by(AIReport.created_at.desc())
        .first()
    )
    setup_check = (
        db.query(AIReport)
        .filter(
            AIReport.company_id == company_id,
            AIReport.task_id == task.id,
            AIReport.stage == "setup_check",
        )
        .order_by(AIReport.created_at.desc())
        .first()
    )
    first_piece_ai = (
        db.query(AIReport)
        .filter(
            AIReport.company_id == company_id,
            AIReport.task_id == task.id,
            AIReport.stage == "first_piece",
        )
        .order_by(AIReport.created_at.desc())
        .first()
    )
    in_process_qc = (
        db.query(QCReport)
        .filter(
            QCReport.company_id == company_id,
            QCReport.task_id == task.id,
            QCReport.stage == "in_process",
        )
        .order_by(QCReport.created_at.desc())
        .first()
    )
    first_piece_qc = (
        db.query(QCReport)
        .filter(
            QCReport.company_id == company_id,
            QCReport.task_id == task.id,
            QCReport.stage == "first_piece",
        )
        .order_by(QCReport.created_at.desc())
        .first()
    )
    final_ai = (
        db.query(AIReport)
        .filter(
            AIReport.company_id == company_id,
            AIReport.task_id == task.id,
            AIReport.stage == "final_inspection",
        )
        .order_by(AIReport.created_at.desc())
        .first()
    )
    latest_dispatch = (
        db.query(DispatchRecord)
        .filter(
            DispatchRecord.company_id == company_id,
            DispatchRecord.task_id == task.id,
        )
        .order_by(DispatchRecord.created_at.desc())
        .first()
    )
    rework_history = (
        db.query(ReworkLog)
        .filter(ReworkLog.company_id == company_id, ReworkLog.task_id == task.id)
        .order_by(ReworkLog.created_at.desc())
        .all()
    )
    return {
        "task": _task_to_response(task).model_dump(),
        "client": _client_payload_for_task(db, company_id, task),
        "process_plan_locked": has_locked_process_plan(db, company_id, task.id),
        "latest_assignment": _serialize_assignment(latest_assignment),
        "material_validation": _serialize_ai_report(material_validation),
        "setup_check": _serialize_ai_report(setup_check),
        "first_piece_qc": _serialize_qc_report(first_piece_qc),
        "first_piece_ai": _serialize_ai_report(first_piece_ai),
        "in_process_qc": _serialize_qc_report(in_process_qc),
        "final_inspection": _serialize_ai_report(final_ai),
        "production_totals": get_production_totals(db, company_id, task.id),
        "dispatch": _serialize_dispatch(latest_dispatch),
        "rework_history": [
            {
                "id": str(item.id),
                "iteration": item.iteration,
                "reason": item.reason,
                "created_at": item.created_at.isoformat(),
                "ai_recommendation": item.ai_recommendation or {},
            }
            for item in rework_history
        ],
    }


# ── Lock Job (───────────────────────────────────────────────

@router.post("/{task_id}/lock")
def lock_job_route(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    Lock CNC job specs. Verifies all specs are confirmed before locking.
    Job status → 'created'. After lock, no specs or process changes allowed.
    """
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Job not found")

    if task.is_locked:
        raise HTTPException(status_code=400, detail="Job is already locked")

    # Verify all specs are confirmed
    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == current_user.company_id,
    ).all()

    if not specs:
        raise HTTPException(status_code=400, detail="Extract and verify drawing specs before locking the job")

    unconfirmed = [s.field_name for s in specs if not s.is_confirmed]
    if unconfirmed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot lock: {len(unconfirmed)} spec(s) not confirmed: {', '.join(unconfirmed[:3])}"
        )

    task.is_locked = True
    task.status = "created"

    create_job_version(
        db,
        company_id=current_user.company_id,
        task_id=task_id,
        created_by=current_user.id,
        version_type="spec_lock",
        snapshot={
            "task": {
                "title": task.title,
                "part_name": task.part_name,
                "material_type": task.material_type,
                "material_batch": task.material_batch,
                "drawing_url": task.drawing_url,
                "status": task.status,
            },
            "specs": build_spec_snapshot(db, current_user.company_id, task_id),
        },
    )

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="task.locked",
        resource_type="task",
        resource_id=task.id,
        details={"specs_confirmed": len(specs)},
    )
    db.commit()

    from app.api.v1.websocket import broadcast_task_update, broadcast_notification
    resp = _task_to_response(task)
    background_tasks.add_task(broadcast_task_update, current_user.company_id, resp.model_dump())
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"Job '{task.title}' specs locked. Process planning can begin.",
        "success",
    )

    return {
        "message": "Job specs locked successfully. Status → created.",
        "task_id": str(task_id),
        "status": task.status,
        "specs_locked": len(specs),
    }


# ── Trigger Rework ───────────────────────────────────────────

@router.post("/{task_id}/rework")
async def trigger_rework_route(
    task_id: UUID,
    request: ReworkRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    Trigger rework loop. Resets execution (not history).
    - status → in_progress
    - rework_flag = True
    - rework_iteration++
    - All dashboards notified via WebSocket
    - AI rework suggestion returned
    """
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Job not found")

    previous_status = task.status
    task.rework_flag = True
    task.rework_iteration = (task.rework_iteration or 0) + 1
    task.rework_reason = request.rework_reason
    task.status = "in_progress"  # Reset execution, preserve history

    create_job_version(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        created_by=current_user.id,
        version_type="rework_reset",
        snapshot={
            "status_before_reset": previous_status,
            "specs": build_spec_snapshot(db, current_user.company_id, task.id),
            "process_plan": build_process_snapshot(db, current_user.company_id, task.id),
        },
    )

    # Optionally reassign operator
    if request.reassign_to:
        from uuid import UUID as _UUID
        try:
            task.assigned_to = _UUID(request.reassign_to)
        except Exception:
            pass  # Invalid UUID, keep existing assignment

    for op in db.query(JobProcess).filter(
        JobProcess.task_id == task.id,
        JobProcess.company_id == current_user.company_id,
    ).all():
        op.is_locked = False

    # Get AI rework suggestion before persisting the reset so it can be stored as history.
    ai_suggestion = get_rework_suggestion(
        db, current_user.company_id, task_id, request.rework_reason
    )
    record_rework(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        iteration=task.rework_iteration,
        triggered_by=current_user.id,
        reason=request.rework_reason,
        ai_recommendation=ai_suggestion,
    )

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="task.rework_triggered",
        resource_type="task",
        resource_id=task.id,
        details={
            "rework_iteration": task.rework_iteration,
            "rework_reason": request.rework_reason,
        },
    )
    db.commit()

    # Broadcast to all dashboards
    from app.api.v1.websocket import broadcast_task_update, broadcast_notification
    resp = _task_to_response(task)
    background_tasks.add_task(broadcast_task_update, current_user.company_id, resp.model_dump())
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"Job '{task.title}' sent to Rework (iteration #{task.rework_iteration}). {request.rework_reason or ''}",
        "warning",
    )

    return {
        "message": f"Rework triggered. Iteration #{task.rework_iteration}.",
        "task_id": str(task_id),
        "rework_iteration": task.rework_iteration,
        "status": task.status,
        "task": resp,
        "ai_suggestion": ai_suggestion,
    }


# ── Update CNC Fields ──────────────────────────────────────────

@router.patch("/{task_id}/cnc-fields")
def update_cnc_fields_route(
    task_id: UUID,
    request: CNCFieldsRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Update CNC-specific fields (part name, material, drawing URL)."""
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Job not found")

    if task.is_locked:
        raise HTTPException(status_code=400, detail="Job is locked — CNC fields cannot be edited")

    if request.part_name is not None:
        task.part_name = request.part_name
    if request.material_type is not None:
        task.material_type = request.material_type
    if request.material_batch is not None:
        task.material_batch = request.material_batch
    if request.operation_type is not None:
        task.operation_type = request.operation_type
        if request.operation_type != "Other":
            task.operation_other = None
    if request.operation_other is not None:
        task.operation_other = request.operation_other if task.operation_type == "Other" else None
    if request.drawing_url is not None:
        task.drawing_url = request.drawing_url

    db.commit()
    return _task_to_response(task)


# ── AI Setup Analysis ───────────────────────────────────────────

@router.post("/{task_id}/material-validation", status_code=status.HTTP_200_OK)
def validate_material_route(
    task_id: UUID,
    request: MaterialValidationRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Validate raw material against the locked job before assignment."""
    task = _get_scoped_task(db, current_user.company_id, task_id)
    if not task.is_locked:
        raise HTTPException(status_code=400, detail="Lock job specs before validating material")
    if not has_locked_process_plan(db, current_user.company_id, task_id):
        raise HTTPException(status_code=400, detail="Lock the process plan before validating material")

    if request.material_type is not None:
        task.material_type = request.material_type
    if request.material_batch is not None:
        task.material_batch = request.material_batch

    if not task.material_type or not task.material_batch:
        raise HTTPException(status_code=400, detail="Material type and batch are required for validation")

    result = {
        "status": "ready",
        "confidence": 0.87,
        "message": f"Material {task.material_type} batch {task.material_batch} is ready for execution.",
        "suggestion": "Proceed to smart assignment.",
    }
    task.status = "ready"
    record_ai_report(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        stage="material_validation",
        status=result["status"],
        confidence=result["confidence"],
        suggestion=result["suggestion"],
        payload={
            "material_type": task.material_type,
            "material_batch": task.material_batch,
            "message": result["message"],
        },
    )
    db.commit()
    _broadcast_mes_task_update(
        background_tasks,
        current_user.company_id,
        task,
        message=f"Material validated for '{task.title}'. Job is ready for assignment.",
        severity="success",
    )
    return {"task": _task_to_response(task), "validation": result}


@router.post("/{task_id}/mes-assign", status_code=status.HTTP_200_OK)
def mes_assign_route(
    task_id: UUID,
    request: MESAssignmentRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Assign operator and machine after a job reaches READY state."""
    task = _get_scoped_task(db, current_user.company_id, task_id)
    if not task.is_locked:
        raise HTTPException(status_code=400, detail="Lock the CNC job before assignment")
    if task.status not in {"ready", "assigned"} and not task.rework_flag:
        raise HTTPException(status_code=400, detail="Material validation must mark the job READY before assignment")

    suggested_operator = find_best_operator(db, current_user.company_id)
    suggested_machine = (
        db.query(Machine)
        .filter(
            Machine.company_id == current_user.company_id,
            Machine.status.in_(["idle", "active"]),
        )
        .order_by(Machine.created_at.asc())
        .first()
    )

    assigned_to = request.assigned_to
    machine_id = request.machine_id
    ai_recommended = False
    if request.use_ai_recommendation:
        if assigned_to is None and suggested_operator:
            assigned_to = suggested_operator.id
        if machine_id is None and suggested_machine:
            machine_id = suggested_machine.id
        ai_recommended = True

    if not assigned_to or not machine_id:
        raise HTTPException(status_code=400, detail="Assign both an operator and a machine for CNC execution")

    if assigned_to:
        task_result, error = assign_task(
            db, current_user.company_id, task.id, assigned_to, current_user.id
        )
        if error or not task_result:
            raise HTTPException(status_code=400, detail=error or "Unable to assign operator")
        task = task_result

    if machine_id:
        machine = db.query(Machine).filter(
            Machine.id == machine_id,
            Machine.company_id == current_user.company_id,
        ).first()
        if not machine:
            raise HTTPException(status_code=400, detail="Machine not found in your company")
        task.machine_id = machine.id

    task.status = "assigned"
    record_assignment(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        operator_id=task.assigned_to,
        machine_id=task.machine_id,
        assigned_by=current_user.id,
        assignment_type="rework" if task.rework_flag else "initial",
        ai_recommended=ai_recommended,
        notes=request.notes,
    )
    db.commit()
    _broadcast_mes_task_update(
        background_tasks,
        current_user.company_id,
        task,
        message=f"Job '{task.title}' assigned for execution.",
        severity="info",
    )
    return {
        "task": _task_to_response(task),
        "suggestions": {
            "operator": _operator_to_payload(suggested_operator) if suggested_operator else None,
            "machine": {
                "id": str(suggested_machine.id),
                "name": suggested_machine.name,
                "machine_type": suggested_machine.machine_type,
            } if suggested_machine else None,
        },
    }

@router.post("/{task_id}/ai-setup-check")
def ai_setup_check_route(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """AI analyzes the setup image for alignment and tooling issues."""
    if current_user.role == "client":
        raise HTTPException(status_code=403, detail="Clients cannot run setup checks")

    task = _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    if task.status not in {"assigned", "setup", "setup_done"} and not task.rework_flag:
        raise HTTPException(status_code=400, detail="Job must be assigned before setup verification")

    image_url = _latest_media_url(db, task.id) or task.drawing_url
    result = analyze_setup_image(str(task_id), image_url)
    task.status = "setup_done" if result.get("status") == "ok" else "setup"
    record_ai_report(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        stage="setup_check",
        status=result.get("status", "unknown"),
        confidence=result.get("confidence"),
        suggestion=result.get("suggestion"),
        decision="PROCEED" if result.get("status") == "ok" else "HOLD",
        payload=result,
    )
    db.commit()
    _broadcast_mes_task_update(
        background_tasks,
        current_user.company_id,
        task,
        message=f"Setup check completed for '{task.title}'.",
        severity="warning" if result.get("status") != "ok" else "success",
    )
    return {"task": _task_to_response(task), "analysis": result}


@router.post("/{task_id}/first-piece-review", status_code=status.HTTP_200_OK)
def first_piece_review_route(
    task_id: UUID,
    request: FirstPieceRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """QC + AI gate that decides whether live production can continue."""
    if current_user.role == "client":
        raise HTTPException(status_code=403, detail="Clients cannot submit first-piece reviews")

    task = _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    if task.status not in {"setup_done", "setup", "first_piece_approval"}:
        raise HTTPException(status_code=400, detail="Complete setup verification before first-piece approval")

    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task.id,
        JobSpec.company_id == current_user.company_id,
    ).all()
    ai_result = analyze_final_inspection(
        str(task.id),
        _latest_media_url(db, task.id) or task.drawing_url,
        [{"field": s.field_name, "value": s.human_value or s.ai_value} for s in specs],
    )

    # AI can inform the review, but it must not override the human gate decision.
    approved = request.qc_status == "pass"
    task.status = "in_progress" if approved else "setup"

    qc_report = QCReport(
        company_id=current_user.company_id,
        task_id=task.id,
        recorded_by=current_user.id,
        stage="first_piece",
        qc_status="pass" if approved else "fail",
        measured_values=request.measurements,
        remarks=request.notes,
    )
    db.add(qc_report)
    record_ai_report(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        stage="first_piece",
        status=ai_result.get("status", "unknown"),
        confidence=ai_result.get("confidence"),
        suggestion=ai_result.get("suggestion"),
        decision=(
            "APPROVE"
            if approved
            else (
                ai_result.get("decision")
                if str(ai_result.get("decision") or "").strip()
                else "REJECT"
            )
        ),
        payload=ai_result,
    )
    db.commit()
    db.refresh(qc_report)
    _broadcast_mes_task_update(
        background_tasks,
        current_user.company_id,
        task,
        message=f"First-piece review for '{task.title}' returned {'approved' if approved else 'rejected'}.",
        severity="success" if approved else "warning",
    )
    return {
        "task": _task_to_response(task),
        "qc_report": _serialize_qc_report(qc_report),
        "ai_result": ai_result,
        "decision": "APPROVE" if approved else "REJECT",
    }


@router.post("/{task_id}/production-log", status_code=status.HTTP_201_CREATED)
def create_production_log_route(
    task_id: UUID,
    request: ProductionLogRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Log production output, scrap, and downtime during live execution."""
    if current_user.role == "client":
        raise HTTPException(status_code=403, detail="Clients cannot log production")

    task = _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    if task.status not in {"in_progress", "qc_check"}:
        raise HTTPException(status_code=400, detail="Production logs can be added only during live production")

    log = ProductionLog(
        company_id=current_user.company_id,
        task_id=task.id,
        logged_by=current_user.id,
        produced_qty=request.produced_qty,
        rejected_qty=request.rejected_qty,
        downtime_minutes=request.downtime_minutes,
        notes=request.notes,
    )
    db.add(log)

    status_label = "ok"
    suggestion = "Production looks stable."
    if request.rejected_qty > 0 or request.downtime_minutes >= 15:
        status_label = "warning"
        suggestion = "Investigate rejects and downtime before the next batch."

    record_ai_report(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        stage="production_monitoring",
        status=status_label,
        confidence=0.78,
        suggestion=suggestion,
        payload={
            "produced_qty": request.produced_qty,
            "rejected_qty": request.rejected_qty,
            "downtime_minutes": request.downtime_minutes,
        },
    )
    db.commit()
    db.refresh(log)
    return {
        "log": {
            "id": str(log.id),
            "produced_qty": log.produced_qty,
            "rejected_qty": log.rejected_qty,
            "downtime_minutes": log.downtime_minutes,
            "notes": log.notes,
            "created_at": log.created_at.isoformat(),
        },
        "totals": get_production_totals(db, current_user.company_id, task.id),
    }


@router.get("/{task_id}/production-logs", status_code=status.HTTP_200_OK)
def list_production_logs_route(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    task = _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    logs = (
        db.query(ProductionLog)
        .filter(ProductionLog.company_id == current_user.company_id, ProductionLog.task_id == task.id)
        .order_by(ProductionLog.created_at.desc())
        .all()
    )
    return {
        "task_id": str(task.id),
        "totals": get_production_totals(db, current_user.company_id, task.id),
        "logs": [
            {
                "id": str(item.id),
                "produced_qty": item.produced_qty,
                "rejected_qty": item.rejected_qty,
                "downtime_minutes": item.downtime_minutes,
                "notes": item.notes,
                "created_at": item.created_at.isoformat(),
            }
            for item in logs
        ],
    }


@router.post("/{task_id}/qc-report", status_code=status.HTTP_201_CREATED)
def create_qc_report_route(
    task_id: UUID,
    request: QCStageReportRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Record in-process QC and AI-backed defect prediction."""
    task = _get_scoped_task(db, current_user.company_id, task_id)
    if task.status not in {"in_progress", "qc_check"}:
        raise HTTPException(status_code=400, detail="In-process QC is available only during production")

    task.status = "in_progress" if request.qc_status == "pass" else "qc_check"
    report = QCReport(
        company_id=current_user.company_id,
        task_id=task.id,
        recorded_by=current_user.id,
        stage="in_process",
        qc_status=request.qc_status,
        measured_values=request.measurements,
        remarks=request.remarks,
    )
    db.add(report)
    record_ai_report(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        stage="predictive_qc",
        status="ok" if request.qc_status == "pass" else "warning",
        confidence=0.81,
        suggestion=(
            "Continue production."
            if request.qc_status == "pass"
            else "Review measurements and prepare for rework if drift continues."
        ),
        decision="PASS" if request.qc_status == "pass" else "CHECK",
        payload={"measurements": request.measurements, "remarks": request.remarks},
    )
    db.commit()
    db.refresh(report)
    _broadcast_mes_task_update(
        background_tasks,
        current_user.company_id,
        task,
        message=f"In-process QC recorded for '{task.title}'.",
        severity="info" if request.qc_status == "pass" else "warning",
    )
    return {"task": _task_to_response(task), "qc_report": _serialize_qc_report(report)}


# ── AI Final Inspection ─────────────────────────────────────────

@router.post("/{task_id}/ai-final-inspection")
def ai_final_inspection_route(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """AI analyzes final inspection images. Returns APPROVE or REWORK decision."""
    if current_user.role == "client":
        raise HTTPException(status_code=403, detail="Clients cannot run final inspection")

    task = _get_accessible_task_or_404(db, current_user.company_id, current_user, task_id)
    if task.status not in {"in_progress", "qc_check", "final_inspection"}:
        raise HTTPException(status_code=400, detail="Job must be in production before final inspection")

    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == current_user.company_id,
    ).all()
    specs_data = [{"field": s.field_name, "value": s.human_value or s.ai_value} for s in specs]

    result = analyze_final_inspection(str(task_id), _latest_media_url(db, task.id) or task.drawing_url, specs_data)

    # Update status to final_inspection
    if task.status not in ("completed", "dispatched"):
        task.status = "final_inspection"
    record_ai_report(
        db,
        company_id=current_user.company_id,
        task_id=task.id,
        stage="final_inspection",
        status=result.get("status", "unknown"),
        confidence=result.get("confidence"),
        suggestion=result.get("suggestion"),
        decision=result.get("decision"),
        payload=result,
    )
    db.commit()

    # Broadcast result
    from app.api.v1.websocket import broadcast_notification
    severity = "error" if result.get("decision") == "REWORK" else "success"
    _broadcast_mes_task_update(background_tasks, current_user.company_id, task)
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"AI Inspection for '{task.title}': {result.get('message', '')}",
        severity,
    )

    return {"task": _task_to_response(task), "inspection": result}


@router.post("/{task_id}/supervisor-final-decision", status_code=status.HTTP_200_OK)
async def supervisor_final_decision_route(
    task_id: UUID,
    request: SupervisorFinalDecisionRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Human review after AI final inspection."""
    task = _get_scoped_task(db, current_user.company_id, task_id)
    if task.status != "final_inspection":
        raise HTTPException(status_code=400, detail="Run final inspection before recording the supervisor decision")

    if request.decision == "rework":
        return await trigger_rework_route(
            task_id,
            ReworkRequest(rework_reason=request.remarks),
            background_tasks,
            db,
            current_user,
        )

    report = QCReport(
        company_id=current_user.company_id,
        task_id=task.id,
        recorded_by=current_user.id,
        stage="final",
        qc_status="pass",
        measured_values={},
        remarks=request.remarks,
    )
    db.add(report)
    db.commit()
    return {"task": _task_to_response(task), "final_decision": "approved_for_dispatch"}


@router.post("/{task_id}/dispatch", status_code=status.HTTP_200_OK)
def dispatch_job_route(
    task_id: UUID,
    request: DispatchRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Record packing/invoice/transport and move the job to DISPATCHED."""
    task = _get_scoped_task(db, current_user.company_id, task_id)
    if task.status != "final_inspection":
        raise HTTPException(status_code=400, detail="Finalize inspection approval before dispatch")

    dispatch_record = DispatchRecord(
        company_id=current_user.company_id,
        task_id=task.id,
        dispatched_by=current_user.id,
        packing_details=request.packing_details,
        invoice_number=request.invoice_number,
        transport_details=request.transport_details,
    )
    db.add(dispatch_record)
    task.status = "dispatched"
    db.commit()
    db.refresh(dispatch_record)
    _broadcast_mes_task_update(
        background_tasks,
        current_user.company_id,
        task,
        message=f"Job '{task.title}' has been dispatched.",
        severity="success",
    )
    return {"task": _task_to_response(task), "dispatch": _serialize_dispatch(dispatch_record)}
