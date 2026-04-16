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
    get_task,
    get_task_logs,
    list_tasks,
    update_task,
    update_task_status,
    user_can_access_task,
)
from pydantic import BaseModel
from app.models.task import Task
from app.models.job_spec import JobSpec
from app.services.cnc_ai_service import get_rework_suggestion, analyze_setup_image, analyze_final_inspection
from app.services.task_queue import dequeue_task, peek_queue, queue_size
from app.services.ai_action_engine import evaluate_operator_load
from app.services.operator_service import MAX_TASKS_PER_OPERATOR
from app.core.dependencies import require_roles

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
    drawing_url: str | None = None


class ReworkRequest(BaseModel):
    rework_reason: str | None = None
    reassign_to: str | None = None  # operator user_id


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

    unconfirmed = [s.field_name for s in specs if not s.is_confirmed]
    if unconfirmed:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot lock: {len(unconfirmed)} spec(s) not confirmed: {', '.join(unconfirmed[:3])}"
        )

    task.is_locked = True
    task.status = "created"

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

    task.rework_flag = True
    task.rework_iteration = (task.rework_iteration or 0) + 1
    task.rework_reason = request.rework_reason
    task.status = "in_progress"  # Reset execution, preserve history

    # Optionally reassign operator
    if request.reassign_to:
        from uuid import UUID as _UUID
        try:
            task.assigned_to = _UUID(request.reassign_to)
        except Exception:
            pass  # Invalid UUID, keep existing assignment

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

    # Get AI rework suggestion
    ai_suggestion = get_rework_suggestion(
        db, current_user.company_id, task_id, request.rework_reason
    )

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
    if request.drawing_url is not None:
        task.drawing_url = request.drawing_url

    db.commit()
    return _task_to_response(task)


# ── AI Setup Analysis ───────────────────────────────────────────

@router.post("/{task_id}/ai-setup-check")
def ai_setup_check_route(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """AI analyzes the setup image for alignment and tooling issues."""
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Job not found")

    return analyze_setup_image(str(task_id), task.drawing_url)


# ── AI Final Inspection ─────────────────────────────────────────

@router.post("/{task_id}/ai-final-inspection")
def ai_final_inspection_route(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """AI analyzes final inspection images. Returns APPROVE or REWORK decision."""
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Job not found")

    specs = db.query(JobSpec).filter(
        JobSpec.task_id == task_id,
        JobSpec.company_id == current_user.company_id,
    ).all()
    specs_data = [{"field": s.field_name, "value": s.human_value or s.ai_value} for s in specs]

    result = analyze_final_inspection(str(task_id), task.drawing_url, specs_data)

    # Update status to final_inspection
    if task.status not in ("completed", "dispatched"):
        task.status = "final_inspection"
        db.commit()

    # Broadcast result
    from app.api.v1.websocket import broadcast_notification
    severity = "error" if result.get("decision") == "REWORK" else "success"
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"AI Inspection for '{task.title}': {result.get('message', '')}",
        severity,
    )

    return result
