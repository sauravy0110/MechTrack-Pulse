"""
MechTrack Pulse — AI Service

Rule-based delay prediction and operator performance scoring.
Phase 1: Simple heuristics. Phase 2: ML model replacement.

DELAY PREDICTION FACTORS:
  - Priority (critical tasks more likely to be rushed → less delay)
  - Operator history (delay_rate from operator_scores)
  - Current workload (active task count)
  - Time of day (end-of-day tasks have higher delay risk)

PERFORMANCE SCORING:
  - efficiency_score = completed / (completed + delayed) * 100
  - delay_rate = delayed / total_tasks
  - avg_completion_time = mean(actual - created for completed tasks)
"""

from datetime import date, datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.task import Task
from app.models.task_log import TaskLog
from app.models.user import User
from app.models.operator_score import OperatorScore
from app.models.ai_insight import AIInsight


def predict_delay(
    db: Session,
    company_id: UUID,
    task_id: UUID,
) -> dict:
    """
    Rule-based delay prediction for a task.
    Returns probability (0-1) and risk factors.
    """
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        return {"error": "Task not found"}

    risk_score = 0.0
    factors = []

    # Factor 1: Priority
    priority_weights = {"low": 0.1, "medium": 0.2, "high": 0.3, "critical": 0.15}
    risk_score += priority_weights.get(task.priority, 0.2)
    factors.append(f"Priority: {task.priority}")

    # Factor 2: Operator history
    if task.assigned_to:
        latest_score = db.query(OperatorScore).filter(
            OperatorScore.user_id == task.assigned_to,
            OperatorScore.company_id == company_id,
        ).order_by(OperatorScore.score_date.desc()).first()

        if latest_score and latest_score.delay_rate > 0:
            risk_score += latest_score.delay_rate * 0.4
            factors.append(f"Operator delay rate: {latest_score.delay_rate:.2f}")
    else:
        risk_score += 0.15
        factors.append("No operator assigned")

    # Factor 3: Current workload (active tasks for the operator)
    if task.assigned_to:
        active_count = db.query(Task).filter(
            Task.assigned_to == task.assigned_to,
            Task.company_id == company_id,
            Task.status == "in_progress",
        ).count()
        if active_count > 3:
            risk_score += 0.15
            factors.append(f"Operator has {active_count} active tasks (overloaded)")
        elif active_count > 1:
            risk_score += 0.05
            factors.append(f"Operator has {active_count} active tasks")

    # Factor 4: No estimated completion
    if not task.estimated_completion:
        risk_score += 0.1
        factors.append("No estimated completion time set")

    # Clamp to [0, 1]
    delay_probability = min(max(risk_score, 0.0), 1.0)

    # Update task with prediction
    task.delay_probability = delay_probability
    db.commit()

    # Risk level
    if delay_probability > 0.7:
        risk_level = "high"
    elif delay_probability > 0.4:
        risk_level = "medium"
    else:
        risk_level = "low"

    return {
        "task_id": str(task.id),
        "delay_probability": round(delay_probability, 3),
        "risk_level": risk_level,
        "factors": factors,
    }


def calculate_operator_performance(
    db: Session,
    company_id: UUID,
    user_id: UUID,
    score_date: date | None = None,
) -> dict:
    """
    Calculate and store operator performance metrics.
    """
    if score_date is None:
        score_date = date.today()

    user = db.query(User).filter(
        User.id == user_id,
        User.company_id == company_id,
    ).first()
    if not user:
        return {"error": "User not found"}

    # Count completed and delayed tasks
    completed = db.query(Task).filter(
        Task.assigned_to == user_id,
        Task.company_id == company_id,
        Task.status == "completed",
    ).count()

    delayed = db.query(Task).filter(
        Task.assigned_to == user_id,
        Task.company_id == company_id,
        Task.status == "delayed",
    ).count()

    total = completed + delayed
    if total == 0:
        efficiency = 0.0
        delay_rate = 0.0
    else:
        efficiency = (completed / total) * 100
        delay_rate = delayed / total

    # Average completion time (hours)
    completed_tasks = db.query(Task).filter(
        Task.assigned_to == user_id,
        Task.company_id == company_id,
        Task.status == "completed",
        Task.actual_completion.isnot(None),
    ).all()

    avg_hours = None
    if completed_tasks:
        total_hours = sum(
            (t.actual_completion - t.created_at).total_seconds() / 3600
            for t in completed_tasks
            if t.actual_completion
        )
        avg_hours = total_hours / len(completed_tasks)

    # Upsert score
    existing = db.query(OperatorScore).filter(
        OperatorScore.user_id == user_id,
        OperatorScore.score_date == score_date,
    ).first()

    if existing:
        existing.efficiency_score = efficiency
        existing.delay_rate = delay_rate
        existing.tasks_completed = completed
        existing.tasks_delayed = delayed
        existing.avg_completion_time = avg_hours
        score = existing
    else:
        score = OperatorScore(
            user_id=user_id,
            company_id=company_id,
            efficiency_score=efficiency,
            delay_rate=delay_rate,
            tasks_completed=completed,
            tasks_delayed=delayed,
            avg_completion_time=avg_hours,
            score_date=score_date,
        )
        db.add(score)

    db.commit()

    return {
        "user_id": str(user_id),
        "full_name": user.full_name,
        "efficiency_score": round(efficiency, 2),
        "delay_rate": round(delay_rate, 3),
        "tasks_completed": completed,
        "tasks_delayed": delayed,
        "avg_completion_time_hours": round(avg_hours, 2) if avg_hours else None,
        "score_date": str(score_date),
    }


def generate_insights(
    db: Session,
    company_id: UUID,
) -> list[dict]:
    """
    Generate AI insights for a company based on current data.
    """
    insights = []

    # Insight 1: Overloaded operators
    operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
    ).all()

    for op in operators:
        active_count = db.query(Task).filter(
            Task.assigned_to == op.id,
            Task.company_id == company_id,
            Task.status == "in_progress",
        ).count()
        if active_count >= 5:
            # Find an alternative operator with least tasks
            from app.services.operator_service import find_best_operator
            alternative = find_best_operator(db, company_id)
            suggestion_text = ""
            if alternative and alternative.id != op.id:
                suggestion_text = f" Suggest reassigning to {alternative.full_name}."
                
            insight = AIInsight(
                company_id=company_id,
                insight_type="overload",
                message=f"{op.full_name} has {active_count} active tasks.{suggestion_text}",
                related_user=op.id,
                severity="warning",
            )
            db.add(insight)
            insights.append({
                "type": "overload",
                "message": insight.message,
                "severity": "warning",
                "related_user": str(op.id),
            })

    # Insight 2: High delay tasks
    high_delay_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.delay_probability > 0.7,
        Task.status.in_(["idle", "in_progress"]),
    ).all()

    for task in high_delay_tasks:
        insight = AIInsight(
            company_id=company_id,
            insight_type="delay_risk",
            message=f"Task '{task.title}' has {task.delay_probability:.0%} delay probability.",
            related_task=task.id,
            severity="critical" if task.delay_probability > 0.85 else "warning",
        )
        db.add(insight)
        insights.append({
            "type": "delay_risk",
            "message": insight.message,
            "severity": insight.severity,
            "related_task": str(task.id),
        })

    # Insight 3: Unassigned tasks
    unassigned_count = db.query(Task).filter(
        Task.company_id == company_id,
        Task.assigned_to.is_(None),
        Task.status == "idle",
    ).count()

    if unassigned_count > 5:
        insight = AIInsight(
            company_id=company_id,
            insight_type="efficiency",
            message=f"{unassigned_count} tasks are unassigned. Consider distributing workload.",
            severity="info",
        )
        db.add(insight)
        insights.append({
            "type": "efficiency",
            "message": insight.message,
            "severity": "info",
        })

    db.commit()
    return insights


def calculate_machine_risks(db: Session, company_id: UUID) -> list[dict]:
    """
    Calculate an aggregated risk score for each machine based on its currently active tasks.
    Used for 3D UI floating indicators.
    """
    from app.models.machine import Machine
    
    machines = db.query(Machine).filter(Machine.company_id == company_id).all()
    results = []
    
    for machine in machines:
        tasks = db.query(Task).filter(
            Task.machine_id == machine.id,
            Task.status.in_(["in_progress", "idle", "queued"]),
            Task.delay_probability.isnot(None)
        ).all()
        
        if not tasks:
            results.append({"machine_id": str(machine.id), "risk_score": 0.0, "status": machine.status})
            continue
            
        avg_risk = sum(t.delay_probability for t in tasks) / len(tasks)
        results.append({
            "machine_id": str(machine.id),
            "risk_score": round(avg_risk, 2),
            "status": machine.status
        })

    return results
