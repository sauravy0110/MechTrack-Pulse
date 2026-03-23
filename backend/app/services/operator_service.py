"""
MechTrack Pulse — Operator Service

Business logic for operator duty management and smart task allocation.
Implements Uber/Zomato-style assignment: least-loaded, most-idle operator.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import asc
from sqlalchemy.orm import Session

from app.models.task import Task
from app.models.user import User


MAX_TASKS_PER_OPERATOR = 5


def toggle_duty(db: Session, user: User) -> User:
    """Toggle operator on/off duty and update last_active_at."""
    user.is_on_duty = not user.is_on_duty
    user.last_active_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)
    return user


def get_operators(db: Session, company_id: UUID) -> list[User]:
    """Get all operators in a company with their duty status."""
    return db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
    ).order_by(User.full_name).all()


def find_best_operator(db: Session, company_id: UUID) -> User | None:
    """
    Find the best operator for task assignment.

    Algorithm:
    1. Filter: on-duty, active, task_count < MAX
    2. Sort: least tasks first, then least recently active
    3. Return first match (or None)
    """
    return db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
        User.is_on_duty == True,
        User.current_task_count < MAX_TASKS_PER_OPERATOR,
    ).order_by(
        asc(User.current_task_count),
        asc(User.last_active_at),
    ).first()


def auto_assign_task(
    db: Session,
    company_id: UUID,
    task: Task,
) -> tuple[User | None, str]:
    """
    Auto-assign a task to the best available operator.

    Rules:
    - If operator has 0 active (in_progress) tasks → this task becomes in_progress
    - Otherwise → this task becomes queued
    """
    operator = find_best_operator(db, company_id)
    if not operator:
        return None, "No available operator found"

    task.assigned_to = operator.id
    operator.current_task_count += 1
    operator.last_active_at = datetime.now(timezone.utc)

    # Check if operator has any in_progress task already
    active_count = db.query(Task).filter(
        Task.assigned_to == operator.id,
        Task.company_id == company_id,
        Task.status == "in_progress",
    ).count()

    if active_count == 0:
        task.status = "in_progress"
        task.timer_started_at = datetime.now(timezone.utc)
    else:
        task.status = "queued"
        task.timer_started_at = None

    db.commit()
    db.refresh(task)
    db.refresh(operator)
    return operator, ""


def promote_next_queued_task(
    db: Session,
    company_id: UUID,
    operator_id: UUID,
) -> Task | None:
    """
    After an operator completes a task, promote their next queued task
    to in_progress. Returns the promoted task or None.
    """
    next_task = db.query(Task).filter(
        Task.assigned_to == operator_id,
        Task.company_id == company_id,
        Task.status == "queued",
    ).order_by(asc(Task.created_at)).first()

    if next_task:
        next_task.status = "in_progress"
        next_task.timer_started_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(next_task)

    return next_task


def decrement_task_count(db: Session, operator_id: UUID) -> None:
    """Decrement operator's task count when a task completes."""
    operator = db.query(User).filter(User.id == operator_id).first()
    if operator and operator.current_task_count > 0:
        operator.current_task_count -= 1
        operator.last_active_at = datetime.now(timezone.utc)
        db.commit()
