"""
MechTrack Pulse — Analytics API Routes

Dashboard endpoints providing real-time metrics.

Endpoints:
  GET /api/v1/analytics/dashboard   → Company dashboard metrics
  GET /api/v1/analytics/operators   → Operator leaderboard
  GET /api/v1/analytics/tasks       → Task analytics
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.core.dependencies import require_roles, require_password_changed
from app.db.database import get_db
from app.models.task import Task
from app.models.user import User
from app.models.machine import Machine
from app.models.operator_score import OperatorScore
from app.models.ai_insight import AIInsight
from app.services.mes_service import MES_ACTIVE_STATUSES
from app.services.operator_service import get_operator_skill_snapshot, sync_company_operator_states

router = APIRouter()


@router.get("/dashboard")
def get_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    Company dashboard with key metrics.
    Returns task counts, machine status, user stats, and recent insights.
    """
    company_id = current_user.company_id
    sync_company_operator_states(db, company_id)

    # Task metrics
    total_tasks = db.query(Task).filter(Task.company_id == company_id).count()
    completed_tasks = db.query(Task).filter(
        Task.company_id == company_id, Task.status == "completed"
    ).count()
    delayed_tasks = db.query(Task).filter(
        Task.company_id == company_id, Task.status == "delayed"
    ).count()
    active_tasks = db.query(Task).filter(
        Task.company_id == company_id, Task.status.in_(MES_ACTIVE_STATUSES)
    ).count()
    in_progress_tasks = db.query(Task).filter(
        Task.company_id == company_id, Task.status == "in_progress"
    ).count()
    idle_tasks = db.query(Task).filter(
        Task.company_id == company_id, Task.status == "idle"
    ).count()

    # User metrics
    total_users = db.query(User).filter(
        User.company_id == company_id, User.is_active == True
    ).count()
    operators = db.query(User).filter(
        User.company_id == company_id, User.role == "operator", User.is_active == True
    ).count()

    # Machine metrics
    total_machines = db.query(Machine).filter(
        Machine.company_id == company_id
    ).count()
    active_machines = db.query(Machine).filter(
        Machine.company_id == company_id, Machine.status == "active"
    ).count()
    maintenance_machines = db.query(Machine).filter(
        Machine.company_id == company_id, Machine.status == "maintenance"
    ).count()

    # Completion rate
    completion_rate = 0.0
    if total_tasks > 0:
        completion_rate = (completed_tasks / total_tasks) * 100

    # Unread insights
    unread_insights = db.query(AIInsight).filter(
        AIInsight.company_id == company_id, AIInsight.is_read == False
    ).count()

    return {
        "tasks": {
            "total": total_tasks,
            "completed": completed_tasks,
            "delayed": delayed_tasks,
            "active": active_tasks,
            "in_progress": in_progress_tasks,
            "idle": idle_tasks,
            "completion_rate": round(completion_rate, 1),
        },
        "users": {
            "total": total_users,
            "operators": operators,
        },
        "machines": {
            "total": total_machines,
            "active": active_machines,
            "maintenance": maintenance_machines,
        },
        "insights": {
            "unread": unread_insights,
        },
    }


@router.get("/operators")
def get_operator_leaderboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    Operator performance leaderboard.
    Returns ranked operators by efficiency score.
    """
    company_id = current_user.company_id
    operators = sync_company_operator_states(db, company_id)

    leaderboard = []
    for op in operators:
        latest_score = db.query(OperatorScore).filter(
            OperatorScore.user_id == op.id,
        ).order_by(OperatorScore.score_date.desc()).first()

        # Count active tasks
        active_tasks = db.query(Task).filter(
            Task.assigned_to == op.id,
            Task.status.in_(MES_ACTIVE_STATUSES),
        ).count()

        leaderboard.append({
            "user_id": str(op.id),
            "full_name": op.full_name,
            "efficiency_score": latest_score.efficiency_score if latest_score else 0,
            "delay_rate": latest_score.delay_rate if latest_score else 0,
            "tasks_completed": latest_score.tasks_completed if latest_score else 0,
            "active_tasks": active_tasks,
            "skill_score": get_operator_skill_snapshot(db, company_id, op, persist_score=True)["skill_score"],
        })

    # Sort by efficiency descending
    leaderboard.sort(key=lambda x: x["efficiency_score"], reverse=True)

    return leaderboard


@router.get("/tasks")
def get_task_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """
    Detailed task analytics.
    Priority distribution, status breakdown, delay trends.
    """
    company_id = current_user.company_id
    sync_company_operator_states(db, company_id)

    # Status breakdown
    status_counts = {}
    for status in ["idle", "created", "planned", "ready", "assigned", "setup", "in_progress", "qc_check", "final_inspection", "submitted_for_review", "dispatched", "completed", "delayed"]:
        count = db.query(Task).filter(
            Task.company_id == company_id,
            Task.status == status,
        ).count()
        status_counts[status] = count

    # Priority distribution
    priority_counts = {}
    for priority in ["low", "medium", "high", "critical"]:
        count = db.query(Task).filter(
            Task.company_id == company_id,
            Task.priority == priority,
        ).count()
        priority_counts[priority] = count

    # Average completion time
    completed_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.status == "completed",
        Task.actual_completion.isnot(None),
    ).all()

    avg_hours = None
    if completed_tasks:
        total_hours = sum(
            (t.actual_completion - t.created_at).total_seconds() / 3600
            for t in completed_tasks
        )
        avg_hours = round(total_hours / len(completed_tasks), 2)

    # High-risk tasks (delay_probability > 0.5)
    high_risk = db.query(Task).filter(
        Task.company_id == company_id,
        Task.delay_probability > 0.5,
        Task.status.in_(MES_ACTIVE_STATUSES),
    ).count()

    return {
        "status_breakdown": status_counts,
        "priority_distribution": priority_counts,
        "avg_completion_time_hours": avg_hours,
        "high_risk_tasks": high_risk,
        "total_tasks": sum(status_counts.values()),
    }
