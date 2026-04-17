"""
MechTrack Pulse — Operator Service

Business logic for operator duty management and smart task allocation.
Implements shift-aware duty windows plus skill-based assignment.
"""

from datetime import date, datetime, time, timedelta, timezone
from uuid import UUID

from sqlalchemy import asc
from sqlalchemy.orm import Session

from app.models.assignment import Assignment
from app.models.operator_score import OperatorScore
from app.models.rework_log import ReworkLog
from app.models.shift import Shift
from app.models.task import Task
from app.models.user import User


MAX_TASKS_PER_OPERATOR = 5
DEFAULT_SHIFT_HOURS = 9


def _now_utc() -> datetime:
    return datetime.now(timezone.utc)


def _combine_today(local_date: date, local_time: time) -> datetime:
    return datetime.combine(local_date, local_time).replace(tzinfo=timezone.utc)


def get_active_shift_window(
    db: Session,
    company_id: UUID,
    now: datetime | None = None,
) -> tuple[Shift | None, datetime | None, datetime | None]:
    current = now or _now_utc()
    shifts = db.query(Shift).filter(Shift.company_id == company_id).all()
    for shift in shifts:
        start = _combine_today(current.date(), shift.start_time)
        end = _combine_today(current.date(), shift.end_time)
        if shift.end_time <= shift.start_time:
            end += timedelta(days=1)
            if current.time() < shift.end_time:
                start -= timedelta(days=1)
                end -= timedelta(days=1)
        if start <= current <= end:
            return shift, start, end
    return None, None, None


def get_duty_expiration(
    db: Session,
    company_id: UUID,
    now: datetime | None = None,
) -> datetime:
    current = now or _now_utc()
    _, _, shift_end = get_active_shift_window(db, company_id, current)
    if shift_end:
        return shift_end
    return current + timedelta(hours=DEFAULT_SHIFT_HOURS)


def sync_operator_duty_state(
    db: Session,
    user: User,
    *,
    now: datetime | None = None,
    commit: bool = False,
) -> User:
    current = now or _now_utc()
    if (
        user.role == "operator"
        and user.is_on_duty
        and user.duty_expires_at is not None
        and current >= user.duty_expires_at
    ):
        user.is_on_duty = False
        if commit:
            db.commit()
            db.refresh(user)
    return user


def activate_operator_for_login(
    db: Session,
    user: User,
) -> tuple[User, bool]:
    if user.role != "operator":
        return user, False

    current = _now_utc()
    sync_operator_duty_state(db, user, now=current)
    duty_expires_at = get_duty_expiration(db, user.company_id, current)
    changed = not user.is_on_duty or user.duty_expires_at != duty_expires_at
    user.is_on_duty = True
    user.last_active_at = current
    user.duty_expires_at = duty_expires_at
    db.commit()
    db.refresh(user)
    return user, changed


def _feedback_score(user: User) -> float:
    owner_score = float(user.owner_feedback_score or 3.0) / 5.0
    operator_score = float(user.operator_feedback_score or 3.0) / 5.0
    return ((owner_score * 0.7) + (operator_score * 0.3)) * 100.0


def _upsert_operator_score(
    db: Session,
    *,
    company_id: UUID,
    operator: User,
    efficiency_score: float,
    delay_rate: float,
    tasks_completed: int,
    tasks_delayed: int,
    avg_completion_time: float | None,
) -> OperatorScore:
    score_date = _now_utc().date()
    score = db.query(OperatorScore).filter(
        OperatorScore.user_id == operator.id,
        OperatorScore.company_id == company_id,
        OperatorScore.score_date == score_date,
    ).first()
    if score is None:
        score = OperatorScore(
            user_id=operator.id,
            company_id=company_id,
            score_date=score_date,
        )
        db.add(score)

    score.efficiency_score = efficiency_score
    score.delay_rate = delay_rate
    score.tasks_completed = tasks_completed
    score.tasks_delayed = tasks_delayed
    score.avg_completion_time = avg_completion_time
    db.flush()
    return score


def get_operator_skill_snapshot(
    db: Session,
    company_id: UUID,
    operator: User,
    *,
    persist_score: bool = False,
) -> dict:
    completed_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.assigned_to == operator.id,
        Task.status == "completed",
        Task.actual_completion.isnot(None),
    ).all()

    delayed_count = db.query(Task).filter(
        Task.company_id == company_id,
        Task.assigned_to == operator.id,
        Task.status == "delayed",
    ).count()

    assignment_count = db.query(Assignment).filter(
        Assignment.company_id == company_id,
        Assignment.operator_id == operator.id,
    ).count()

    rework_count = db.query(ReworkLog).join(
        Task,
        Task.id == ReworkLog.task_id,
    ).filter(
        ReworkLog.company_id == company_id,
        Task.assigned_to == operator.id,
    ).count()

    tasks_completed = len(completed_tasks)
    successful_works = max(tasks_completed - rework_count, 0)
    total_observed = max(tasks_completed + delayed_count, 1)
    efficiency_score = (tasks_completed / total_observed) * 100.0
    delay_rate = delayed_count / total_observed
    rework_ratio = min(rework_count / max(tasks_completed, 1), 1.0)
    success_ratio = successful_works / max(tasks_completed, 1)

    avg_completion_time = None
    if completed_tasks:
        total_hours = sum(
            max((task.actual_completion - task.created_at).total_seconds() / 3600, 0.25)
            for task in completed_tasks
            if task.actual_completion
        )
        avg_completion_time = total_hours / len(completed_tasks)

    # Faster average completion translates to a higher score.
    speed_score = 50.0
    if avg_completion_time is not None:
        speed_score = max(0.0, min(100.0, 100.0 - ((avg_completion_time - 1.0) * 12.5)))

    feedback_score = _feedback_score(operator)
    experience_score = min((assignment_count / 25.0) * 100.0, 100.0)
    workload_penalty = min((operator.current_task_count / MAX_TASKS_PER_OPERATOR) * 18.0, 18.0)

    skill_score = (
        (speed_score * 0.28)
        + (efficiency_score * 0.22)
        + (success_ratio * 100.0 * 0.18)
        + ((1.0 - rework_ratio) * 100.0 * 0.18)
        + (feedback_score * 0.10)
        + (experience_score * 0.04)
    ) - workload_penalty
    skill_score = round(max(0.0, min(skill_score, 100.0)), 2)

    if persist_score:
        _upsert_operator_score(
            db,
            company_id=company_id,
            operator=operator,
            efficiency_score=round(efficiency_score, 2),
            delay_rate=round(delay_rate, 3),
            tasks_completed=tasks_completed,
            tasks_delayed=delayed_count,
            avg_completion_time=avg_completion_time,
        )

    return {
        "skill_score": skill_score,
        "efficiency_score": round(efficiency_score, 2),
        "delay_rate": round(delay_rate, 3),
        "avg_completion_time_hours": round(avg_completion_time, 2) if avg_completion_time is not None else None,
        "rework_ratio": round(rework_ratio, 3),
        "success_ratio": round(success_ratio, 3),
        "successful_works": successful_works,
        "feedback_score": round(feedback_score, 2),
        "capacity_remaining": max(MAX_TASKS_PER_OPERATOR - operator.current_task_count, 0),
    }


def toggle_duty(db: Session, user: User) -> User:
    """Toggle operator on/off duty and update last_active_at."""
    user.is_on_duty = not user.is_on_duty
    user.last_active_at = _now_utc()
    user.duty_expires_at = get_duty_expiration(db, user.company_id, user.last_active_at) if user.is_on_duty else None
    db.commit()
    db.refresh(user)
    return user


def get_operators(db: Session, company_id: UUID) -> list[User]:
    """Get all operators in a company with their duty status."""
    operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
    ).order_by(User.full_name).all()
    changed = False
    for operator in operators:
        before = operator.is_on_duty
        sync_operator_duty_state(db, operator)
        changed = changed or before != operator.is_on_duty
    if changed:
        db.commit()
        for operator in operators:
            db.refresh(operator)
    return operators


def sync_company_operator_states(
    db: Session,
    company_id: UUID,
) -> list[User]:
    """Expire stale on-duty flags for all operators in a company."""
    operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
    ).all()
    changed = False
    for operator in operators:
        before = operator.is_on_duty
        sync_operator_duty_state(db, operator)
        if before != operator.is_on_duty:
            changed = True
    if changed:
        db.commit()
        for operator in operators:
            db.refresh(operator)
    return operators


def find_best_operator(
    db: Session,
    company_id: UUID,
    *,
    priority: str | None = None,
) -> User | None:
    """
    Find the best operator for task assignment.

    Algorithm:
    1. Filter: on-duty, active, task_count < MAX, duty not expired
    2. Score using efficiency, speed, rework ratio, successful work and feedback
    3. For high/critical jobs, favor stronger skill score
    4. For other jobs, balance skill with current workload
    3. Return first match (or None)
    """
    operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
        User.current_task_count < MAX_TASKS_PER_OPERATOR,
    ).all()

    ranked: list[tuple[float, datetime | None, User]] = []
    for operator in operators:
        sync_operator_duty_state(db, operator)
        if not operator.is_on_duty:
            continue
        metrics = get_operator_skill_snapshot(db, company_id, operator, persist_score=True)
        load_ratio = operator.current_task_count / MAX_TASKS_PER_OPERATOR
        skill_score = metrics["skill_score"]
        if priority in {"critical", "high"}:
            final_score = (skill_score * 0.82) + ((1.0 - load_ratio) * 18.0)
        else:
            final_score = (skill_score * 0.60) + ((1.0 - load_ratio) * 40.0)
        ranked.append((final_score, operator.last_active_at, operator))

    if not ranked:
        return None

    ranked.sort(
        key=lambda item: (
            -item[0],
            item[1] or datetime.fromtimestamp(0, tz=timezone.utc),
            item[2].full_name,
        )
    )
    db.commit()
    return ranked[0][2]


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
    operator = find_best_operator(db, company_id, priority=task.priority)
    if not operator:
        return None, "No available operator found"

    task.assigned_to = operator.id
    operator.current_task_count += 1
    operator.last_active_at = _now_utc()

    # Check if operator has any in_progress task already
    active_count = db.query(Task).filter(
        Task.assigned_to == operator.id,
        Task.company_id == company_id,
        Task.status == "in_progress",
    ).count()

    if active_count == 0:
        task.status = "in_progress"
        task.timer_started_at = _now_utc()
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
        next_task.timer_started_at = _now_utc()
        db.commit()
        db.refresh(next_task)

    return next_task


def decrement_task_count(db: Session, operator_id: UUID) -> None:
    """Decrement operator's task count when a task completes."""
    operator = db.query(User).filter(User.id == operator_id).first()
    if operator and operator.current_task_count > 0:
        operator.current_task_count -= 1
        operator.last_active_at = _now_utc()
        db.commit()


def build_operator_payload(
    db: Session,
    company_id: UUID,
    operator: User,
) -> dict:
    """Serialize operator state consistently for APIs and WebSocket broadcasts."""
    sync_operator_duty_state(db, operator)
    if not operator.is_on_duty:
        status = "offline"
    elif operator.current_task_count >= MAX_TASKS_PER_OPERATOR:
        status = "busy"
    else:
        status = "available"

    payload = {
        "id": str(operator.id),
        "full_name": operator.full_name,
        "email": operator.email,
        "is_on_duty": operator.is_on_duty,
        "current_task_count": operator.current_task_count,
        "last_active_at": operator.last_active_at,
        "duty_expires_at": operator.duty_expires_at,
        "owner_feedback_score": round(float(operator.owner_feedback_score or 3.0), 2),
        "operator_feedback_score": round(float(operator.operator_feedback_score or 3.0), 2),
        "status": status,
    }
    payload.update(get_operator_skill_snapshot(db, company_id, operator, persist_score=True))
    return payload
