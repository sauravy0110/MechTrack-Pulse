"""
MechTrack Pulse — Task Service

Business logic for task CRUD, assignment, status transitions, and logging.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.task import Task
from app.models.task_log import TaskLog
from app.models.user import User
from app.models.machine import Machine
from app.models.subscription import Subscription
from app.services.task_queue import enqueue_task, remove_from_queue
from app.services import operator_service


# Valid status transitions
VALID_TRANSITIONS = {
    "idle": ["in_progress", "queued"],
    "queued": ["in_progress"],
    "in_progress": ["completed", "delayed", "paused"],
    "paused": ["in_progress", "completed", "delayed"],
    "delayed": ["in_progress", "completed", "paused"],
    "completed": [],  # terminal state
}


def _get_company_user(
    db: Session,
    company_id: UUID,
    user_id: UUID,
) -> User | None:
    return db.query(User).filter(
        User.id == user_id,
        User.company_id == company_id,
        User.is_active == True,
    ).first()


def _validate_machine(
    db: Session,
    company_id: UUID,
    machine_id: UUID | None,
) -> tuple[Machine | None, str]:
    if machine_id is None:
        return None, ""

    machine = db.query(Machine).filter(
        Machine.id == machine_id,
        Machine.company_id == company_id,
    ).first()
    if not machine:
        return None, "Machine not found in your company"
    return machine, ""


def _validate_client(
    db: Session,
    company_id: UUID,
    client_id: UUID | None,
) -> tuple[User | None, str]:
    if client_id is None:
        return None, ""

    client = _get_company_user(db, company_id, client_id)
    if not client or client.role != "client":
        return None, "Client user not found in your company"
    return client, ""


def _validate_operator_assignee(
    db: Session,
    company_id: UUID,
    assignee_id: UUID | None,
) -> tuple[User | None, str]:
    if assignee_id is None:
        return None, ""

    assignee = _get_company_user(db, company_id, assignee_id)
    if not assignee or assignee.role != "operator":
        return None, "Assigned operator not found in your company"
    return assignee, ""


def create_task(
    db: Session,
    company_id: UUID,
    created_by: UUID,
    title: str,
    description: str | None = None,
    priority: str = "medium",
    assigned_to: UUID | None = None,
    client_id: UUID | None = None,
    machine_id: UUID | None = None,
    estimated_completion: datetime | None = None,
) -> tuple[Task | None, str]:
    """
    Create a new task. Checks subscription limits.
    If no assignee, task is added to the queue.
    """
    # ── Check subscription task limit ────────────────────
    subscription = db.query(Subscription).filter(
        Subscription.company_id == company_id
    ).first()
    if subscription and not subscription.can_add_task():
        return None, f"Monthly task limit reached ({subscription.max_tasks_per_month}). Upgrade your plan."

    assignee, error = _validate_operator_assignee(db, company_id, assigned_to)
    if error:
        return None, error

    _, error = _validate_machine(db, company_id, machine_id)
    if error:
        return None, error

    _, error = _validate_client(db, company_id, client_id)
    if error:
        return None, error

    task = Task(
        company_id=company_id,
        title=title,
        description=description,
        priority=priority,
        status="idle",
        assigned_to=assigned_to,
        created_by=created_by,
        client_id=client_id,
        machine_id=machine_id,
        estimated_completion=estimated_completion,
    )
    db.add(task)

    # ── Handle Assignment Logic ─────────────────────────
    if assigned_to:
        # Check if operator is on-duty
        if not assignee.is_on_duty:
            return None, "Operator is off-duty"

        # Check operator task limit
        if assignee.current_task_count >= 5:
            return None, "Operator has reached maximum task limit (5)"

        assignee.current_task_count += 1
        assignee.last_active_at = datetime.now(timezone.utc)

        active_count = db.query(Task).filter(
            Task.assigned_to == assigned_to,
            Task.status == "in_progress"
        ).count()

        if active_count == 0:
            task.status = "in_progress"
            task.timer_started_at = datetime.now(timezone.utc)
        else:
            task.status = "queued"
            task.timer_started_at = None

    # Update subscription usage
    if subscription:
        subscription.current_usage_tasks += 1

    db.flush()

    # ── Log creation ─────────────────────────────────────
    log = TaskLog(
        task_id=task.id,
        user_id=created_by,
        action="created",
        new_value=task.status,
    )
    db.add(log)

    # ── Queue unassigned tasks ───────────────────────────
    if not assigned_to:
        enqueue_task(company_id, task.id)

    db.commit()
    db.refresh(task)
    return task, ""


def list_tasks(
    db: Session,
    company_id: UUID,
    status_filter: str | None = None,
    assigned_to: UUID | None = None,
    client_id: UUID | None = None,
    priority_filter: str | None = None,
) -> list[Task]:
    """List tasks scoped to company with optional filters."""
    query = db.query(Task).filter(Task.company_id == company_id)

    if status_filter:
        query = query.filter(Task.status == status_filter)
    if assigned_to:
        query = query.filter(Task.assigned_to == assigned_to)
    if client_id:
        query = query.filter(Task.client_id == client_id)
    if priority_filter:
        query = query.filter(Task.priority == priority_filter)

    return query.order_by(Task.created_at.desc()).all()


def get_task(db: Session, company_id: UUID, task_id: UUID) -> Task | None:
    """Get a single task by ID, scoped to company."""
    return db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()


def update_task_status(
    db: Session,
    company_id: UUID,
    task_id: UUID,
    new_status: str,
    user_id: UUID,
) -> tuple[Task | None, str]:
    """
    Update task status with transition validation.
    Operators can only update their own tasks.
    """
    task = get_task(db, company_id, task_id)
    if not task:
        return None, "Task not found"

    # ── Permission Check ────────────────────────────────
    # Import here to avoid circular imports
    from app.models.user import User
    user = db.query(User).filter(User.id == user_id).first()
    if user and user.role == "operator":
        if task.assigned_to != user_id:
            return None, "You can only update tasks assigned to you"

    # Validate transition
    allowed = VALID_TRANSITIONS.get(task.status, [])
    if new_status not in allowed:
        return None, f"Cannot transition from '{task.status}' to '{new_status}'. Allowed: {allowed}"

    old_status = task.status
    task.status = new_status
    
    now = datetime.now(timezone.utc)

    # Timer Logic: Stop timer if transitioning out of in_progress
    if old_status == "in_progress" and new_status != "in_progress":
        if task.timer_started_at:
            delta = now - task.timer_started_at
            task.total_time_spent_seconds += int(delta.total_seconds())
            task.timer_started_at = None
            
    # Timer Logic: Start timer if transitioning into in_progress
    if new_status == "in_progress":
        task.timer_started_at = now

    # Set completion time
    promoted_task = None
    if new_status == "completed":
        task.actual_completion = now

        # Decrement operator task count and promote next queued task
        if task.assigned_to:
            operator_service.decrement_task_count(db, task.assigned_to)
            promoted_task = operator_service.promote_next_queued_task(
                db, company_id, task.assigned_to
            )

    # Log the change
    log = TaskLog(
        task_id=task.id,
        user_id=user_id,
        action=new_status,
        previous_value=old_status,
        new_value=new_status,
    )
    db.add(log)
    db.commit()
    db.refresh(task)
    if promoted_task:
        setattr(task, "_promoted_task", promoted_task)
    return task, ""


def assign_task(
    db: Session,
    company_id: UUID,
    task_id: UUID,
    assignee_id: UUID,
    assigner_id: UUID,
) -> tuple[Task | None, str]:
    """Assign or reassign a task to a user."""
    task = get_task(db, company_id, task_id)
    if not task:
        return None, "Task not found"

    # Validate assignee
    assignee, error = _validate_operator_assignee(db, company_id, assignee_id)
    if error:
        return None, error

    old_assignee_id = task.assigned_to
    
    # If same assignee, do nothing
    if old_assignee_id == assignee_id:
        return task, ""

    # Check if operator is on-duty
    if not assignee.is_on_duty:
        return None, "Operator is off-duty"

    # Check new assignee limit
    if assignee.current_task_count >= 5:
        return None, "Assignee has reached maximum task limit (5)"

    # Decrement old assignee
    if old_assignee_id:
        old_op = db.query(User).filter(User.id == old_assignee_id).first()
        if old_op and old_op.current_task_count > 0:
            old_op.current_task_count -= 1

    # Increment new assignee
    assignee.current_task_count += 1
    assignee.last_active_at = datetime.now(timezone.utc)
    task.assigned_to = assignee_id

    # Update status if it was idle/queued
    if task.status in ["idle", "queued"]:
        active_count = db.query(Task).filter(
            Task.assigned_to == assignee_id,
            Task.status == "in_progress"
        ).count()
        if active_count == 0:
            task.status = "in_progress"
            task.timer_started_at = datetime.now(timezone.utc)
        else:
            task.status = "queued"
            task.timer_started_at = None

    # Remove from queue if it was unassigned
    remove_from_queue(company_id, task_id)

    # Log
    log = TaskLog(
        task_id=task.id,
        user_id=assigner_id,
        action="reassigned" if old_assignee_id else "assigned",
        previous_value=str(old_assignee_id) if old_assignee_id else None,
        new_value=str(assignee_id),
        details=f"Assigned to {assignee.full_name}",
    )
    db.add(log)
    db.commit()
    db.refresh(task)
    return task, ""


def update_task(
    db: Session,
    company_id: UUID,
    task_id: UUID,
    user_id: UUID,
    updates: dict,
) -> tuple[Task | None, str]:
    """Update task fields (excluding status — use update_task_status for that)."""
    task = get_task(db, company_id, task_id)
    if not task:
        return None, "Task not found"

    # Handle status separately via transition validation
    if "status" in updates and updates["status"]:
        return update_task_status(db, company_id, task_id, updates.pop("status"), user_id)

    if "assigned_to" in updates and updates["assigned_to"] != task.assigned_to:
        return None, "Use the assignment endpoint to change task assignee"

    if "machine_id" in updates:
        _, error = _validate_machine(db, company_id, updates["machine_id"])
        if error:
            return None, error

    if "client_id" in updates:
        _, error = _validate_client(db, company_id, updates["client_id"])
        if error:
            return None, error

    for field, value in updates.items():
        if value is not None and hasattr(task, field):
            setattr(task, field, value)

    log = TaskLog(
        task_id=task.id,
        user_id=user_id,
        action="updated",
        details=f"Updated fields: {', '.join(updates.keys())}",
    )
    db.add(log)

    db.commit()
    db.refresh(task)
    return task, ""


def get_task_logs(db: Session, company_id: UUID, task_id: UUID) -> list[TaskLog]:
    """Get all logs for a task."""
    task = get_task(db, company_id, task_id)
    if not task:
        return []
    return db.query(TaskLog).filter(
        TaskLog.task_id == task_id
    ).order_by(TaskLog.created_at.desc()).all()
