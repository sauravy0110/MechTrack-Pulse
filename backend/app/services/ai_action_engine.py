"""
MechTrack Pulse — AI Action Engine (Auto-Mitigation)

This module should stay compatible with the current ORM models.
The existing UI surfaces AI insights and notifications, so these
helpers perform lightweight mitigation without assuming fields that
do not exist on the current schema.
"""

from uuid import UUID

from app.api.v1.websocket import broadcast_notification
from app.db.database import SessionLocal
from app.models.ai_action_log import AIActionLog
from app.models.task import Task
from app.models.user import User
from app.services.operator_service import find_best_operator


async def evaluate_operator_load(company_id: UUID) -> None:
    """
    Rebalance queued work when an operator is saturated.

    Current schema supports:
    - User.is_on_duty
    - User.current_task_count
    - Task statuses: idle | queued | in_progress | paused | completed | delayed
    """
    db = SessionLocal()
    try:
        overloaded_ops = db.query(User).filter(
            User.company_id == company_id,
            User.role == "operator",
            User.is_active == True,
            User.is_on_duty == True,
            User.current_task_count > 3,
        ).all()

        if not overloaded_ops:
            return

        for old_op in overloaded_ops:
            task = db.query(Task).filter(
                Task.company_id == company_id,
                Task.assigned_to == old_op.id,
                Task.status == "queued",
            ).order_by(Task.created_at.desc()).first()

            if not task:
                continue

            best_op = find_best_operator(db, company_id)
            if not best_op or best_op.id == old_op.id:
                continue

            task.assigned_to = best_op.id
            best_op.current_task_count += 1
            old_op.current_task_count = max(0, old_op.current_task_count - 1)

            action_log = AIActionLog(
                company_id=company_id,
                action_type="LOAD_BALANCING",
                reason=f"Moved '{task.title}' from {old_op.full_name} to {best_op.full_name} to reduce queue pressure.",
                metadata_payload={
                    "task_id": str(task.id),
                    "from_operator": str(old_op.id),
                    "to_operator": str(best_op.id),
                },
            )
            db.add(action_log)
            db.commit()

            await broadcast_notification(
                company_id=company_id,
                message=f"AI load balancing moved '{task.title}' to {best_op.full_name}.",
                severity="info",
            )
    except Exception as e:
        print(f"AI Action Error (Load): {e}")
        db.rollback()
    finally:
        db.close()


async def evaluate_machine_risk(machine_id: UUID) -> None:
    """
    Placeholder for machine-risk mitigation.

    The current machine model does not expose a health score, so keep this
    as a safe no-op until a compatible risk signal exists.
    """
    _ = machine_id
