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
    TaskResponse,
    UpdateTaskRequest,
)
from app.services.task_service import (
    assign_task,
    create_task,
    get_task,
    get_task_logs,
    list_tasks,
    update_task,
    update_task_status,
)
from app.services.task_queue import dequeue_task, peek_queue, queue_size
from app.services.ai_action_engine import evaluate_operator_load
from app.services.operator_service import MAX_TASKS_PER_OPERATOR

router = APIRouter()


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
    from app.api.v1.websocket import broadcast_operator_update, broadcast_task_update
    resp = _task_to_response(task)
    background_tasks.add_task(broadcast_task_update, current_user.company_id, resp.model_dump())

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
    task = get_task(db, current_user.company_id, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Operators can only view their own tasks
    if current_user.role == "operator" and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="You can only view your own tasks")

    if current_user.role == "client" and task.client_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only view your own jobs")

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
    return _task_to_response(task)


# ── Update Task Status ──────────────────────────────────────

@router.patch("/{task_id}/status", response_model=TaskResponse)
async def update_task_status_route(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    new_status: str = Query(..., pattern="^(idle|queued|in_progress|completed|delayed|paused)$"),
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

    task, error = update_task_status(db, current_user.company_id, task_id, new_status, current_user.id)
    if error:
        raise HTTPException(status_code=400, detail=error)
        
    # Broadcast update
    from app.api.v1.websocket import broadcast_operator_update, broadcast_task_update
    resp = _task_to_response(task)
    background_tasks.add_task(broadcast_task_update, current_user.company_id, resp.model_dump())

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
    from app.api.v1.websocket import broadcast_operator_update, broadcast_task_update
    resp = _task_to_response(task)
    background_tasks.add_task(broadcast_task_update, current_user.company_id, resp.model_dump())

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
    current_user: User = Depends(RequirePermission(Permission.VIEW_DASHBOARD)),
):
    """Get audit trail for a task."""
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
