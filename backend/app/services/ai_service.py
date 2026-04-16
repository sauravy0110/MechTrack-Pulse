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

from collections import Counter
from datetime import date, datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.task import Task
from app.models.task_log import TaskLog
from app.models.task_image import TaskImage
from app.models.user import User
from app.models.machine import Machine
from app.models.report import Report
from app.models.operator_score import OperatorScore
from app.models.ai_insight import AIInsight
from app.services.mes_service import MES_ACTIVE_STATUSES
from app.services.operator_service import MAX_TASKS_PER_OPERATOR, find_best_operator
from app.services.openrouter_service import (
    answer_global_question_with_openrouter,
    generate_client_summary_with_openrouter,
    generate_instruction_draft_with_openrouter,
    generate_owner_intelligence_with_openrouter,
    generate_supervisor_intelligence_with_openrouter,
    generate_task_assistant_with_openrouter,
)


ACTIVE_TASK_STATUSES = MES_ACTIVE_STATUSES
DEFAULT_PRIORITY_HOURS = {
    "low": 1.5,
    "medium": 2.5,
    "high": 4.0,
    "critical": 3.0,
}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _format_hours(hours: float | None) -> str:
    if hours is None:
        return "N/A"
    if hours < 1:
        return f"{round(hours * 60)} minutes"
    return f"{hours:.1f} hours"


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _estimate_task_duration_hours(db: Session, company_id: UUID, task: Task) -> float:
    similar_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.id != task.id,
        Task.status == "completed",
        Task.actual_completion.isnot(None),
    )

    if task.machine_id:
        machine_durations = [
            max((candidate.actual_completion - candidate.created_at).total_seconds() / 3600, 0.25)
            for candidate in similar_tasks.filter(Task.machine_id == task.machine_id).limit(10).all()
            if candidate.actual_completion
        ]
        if machine_durations:
            return round(sum(machine_durations) / len(machine_durations), 2)

    priority_durations = [
        max((candidate.actual_completion - candidate.created_at).total_seconds() / 3600, 0.25)
        for candidate in similar_tasks.filter(Task.priority == task.priority).limit(10).all()
        if candidate.actual_completion
    ]
    if priority_durations:
        return round(sum(priority_durations) / len(priority_durations), 2)

    return DEFAULT_PRIORITY_HOURS.get(task.priority, 2.5)


def _task_eta(task: Task, estimated_hours: float | None) -> datetime | None:
    if task.actual_completion:
        return task.actual_completion
    if task.estimated_completion:
        return task.estimated_completion
    if estimated_hours is None:
        return None
    return task.created_at + timedelta(hours=estimated_hours)


def _task_progress(task: Task, estimated_hours: float | None) -> int:
    cnc_progress = {
        "created": 10,
        "planned": 20,
        "ready": 30,
        "assigned": 40,
        "setup": 52,
        "setup_done": 62,
        "first_piece_approval": 72,
        "qc_check": 84,
        "final_inspection": 92,
        "dispatched": 97,
    }
    if task.status == "completed":
        return 100
    if task.status in cnc_progress:
        return cnc_progress[task.status]
    if task.status == "idle":
        return 5
    if task.status == "queued":
        return 15

    eta = _task_eta(task, estimated_hours)
    if eta and eta > task.created_at:
        elapsed = (_now() - task.created_at).total_seconds()
        total_window = (eta - task.created_at).total_seconds()
        ratio = max(min(elapsed / total_window, 0.95), 0.0)
        if task.status == "in_progress":
            return int(max(20, ratio * 100))
        if task.status == "paused":
            return int(max(35, ratio * 100))
        if task.status == "delayed":
            return int(max(60, ratio * 100))

    if task.total_time_spent_seconds and estimated_hours:
        ratio = task.total_time_spent_seconds / max(estimated_hours * 3600, 1)
        return int(max(10, min(ratio * 100, 95)))

    if task.status == "paused":
        return 45
    if task.status == "delayed":
        return 70
    return 25


def _task_steps(title: str, description: str | None, machine_name: str | None) -> list[str]:
    combined = f"{title} {description or ''}".lower()
    steps = [
        "Review the task brief, drawing, and priority before touching the machine.",
        f"Prepare {machine_name} and secure the workpiece." if machine_name else "Prepare the machine, fixture, and measuring tools.",
    ]

    if "align" in combined or "fixture" in combined or "tolerance" in combined:
        steps.append("Align the fixture and verify first-piece tolerance before full execution.")
    else:
        steps.append("Run a setup check and verify the first execution pass.")

    if "inspect" in combined or "check" in combined or "quality" in combined:
        steps.append("Capture measurements and compare them against the required quality limits.")
    else:
        steps.append("Monitor the process during execution and log any deviations immediately.")

    steps.append("Upload proof of work, add a short progress note, and hand off the next step cleanly.")
    return steps[:5]


def generate_instruction_draft(
    title: str,
    *,
    machine_name: str | None = None,
    priority: str = "medium",
    description: str | None = None,
) -> dict:
    fallback_steps = _task_steps(title, description, machine_name)
    fallback_quality_checks = [
        "Confirm tooling, fixture lock, and work offset before the first run.",
        "Inspect the first completed output before continuing at volume.",
        "Record any deviation, delay, or scrap risk in the task log immediately.",
    ]
    fallback_safety_notes = [
        "Wear the required PPE and isolate the machine before manual adjustment.",
        "Stop the run if vibration, heat, or tolerance drift exceeds normal levels.",
    ]
    fallback_instruction_text = "\n".join(
        [f"Task: {title}"]
        + [f"Step {index + 1}: {step}" for index, step in enumerate(fallback_steps)]
        + ["", "Quality checks:"]
        + [f"- {item}" for item in fallback_quality_checks]
        + ["", "Safety notes:"]
        + [f"- {item}" for item in fallback_safety_notes]
    )
    result = {
        "summary": f"{priority.capitalize()} priority workflow for {title}",
        "steps": fallback_steps,
        "quality_checks": fallback_quality_checks,
        "safety_notes": fallback_safety_notes,
        "instruction_text": fallback_instruction_text,
    }

    llm_payload = generate_instruction_draft_with_openrouter({
        "title": title,
        "machine_name": machine_name,
        "priority": priority,
        "description": description,
        "fallback": result,
    })
    if not llm_payload:
        return result

    result["summary"] = str(llm_payload.get("summary") or result["summary"])
    result["steps"] = _string_list(llm_payload.get("steps")) or result["steps"]
    result["quality_checks"] = _string_list(llm_payload.get("quality_checks")) or result["quality_checks"]
    result["safety_notes"] = _string_list(llm_payload.get("safety_notes")) or result["safety_notes"]
    result["instruction_text"] = str(llm_payload.get("instruction_text") or result["instruction_text"])
    return result


def _get_bottleneck_machine(db: Session, company_id: UUID) -> dict | None:
    active_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.machine_id.isnot(None),
        Task.status.in_(ACTIVE_TASK_STATUSES),
    ).all()
    if not active_tasks:
        return None

    machine_task_counter = Counter(task.machine_id for task in active_tasks if task.machine_id)
    machine_id, task_count = machine_task_counter.most_common(1)[0]
    machine = db.query(Machine).filter(
        Machine.id == machine_id,
        Machine.company_id == company_id,
    ).first()
    if not machine:
        return None

    machine_tasks = [task for task in active_tasks if task.machine_id == machine_id]
    avg_risk = round(
        sum(task.delay_probability or 0 for task in machine_tasks) / max(len(machine_tasks), 1),
        2,
    )
    return {
        "machine_id": str(machine.id),
        "machine_name": machine.name,
        "active_task_count": task_count,
        "average_delay_risk": avg_risk,
        "message": f"{machine.name} is the current bottleneck with {task_count} active tasks.",
    }


def _get_operator_workload(db: Session, company_id: UUID) -> list[dict]:
    operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
    ).order_by(User.current_task_count.desc(), User.full_name.asc()).all()
    rows = []
    for operator in operators:
        score = db.query(OperatorScore).filter(
            OperatorScore.company_id == company_id,
            OperatorScore.user_id == operator.id,
        ).order_by(OperatorScore.score_date.desc()).first()
        rows.append({
            "user_id": str(operator.id),
            "full_name": operator.full_name,
            "is_on_duty": operator.is_on_duty,
            "current_task_count": operator.current_task_count,
            "capacity_remaining": max(MAX_TASKS_PER_OPERATOR - operator.current_task_count, 0),
            "efficiency_score": round(score.efficiency_score, 1) if score else None,
            "delay_rate": round(score.delay_rate, 2) if score else None,
        })
    return rows


def _get_assignment_suggestion(db: Session, company_id: UUID, task: Task) -> dict | None:
    best_operator = find_best_operator(db, company_id)
    if not best_operator:
        return None

    score = db.query(OperatorScore).filter(
        OperatorScore.company_id == company_id,
        OperatorScore.user_id == best_operator.id,
    ).order_by(OperatorScore.score_date.desc()).first()

    reasons = [
        f"{best_operator.full_name} is currently on duty.",
        f"Workload is {best_operator.current_task_count}/{MAX_TASKS_PER_OPERATOR}.",
    ]
    if score and score.efficiency_score:
        reasons.append(f"Latest efficiency score is {score.efficiency_score:.1f}%.")
    if task.machine_id:
        reasons.append("This operator has immediate capacity to absorb another machine task.")

    return {
        "user_id": str(best_operator.id),
        "full_name": best_operator.full_name,
        "current_task_count": best_operator.current_task_count,
        "reasons": reasons,
        "message": f"Assign to {best_operator.full_name} for the fastest available handoff.",
    }


def _task_delay_explanation(task: Task) -> str:
    if task.delay_reason:
        return task.delay_reason
    if task.assigned_to is None:
        return "This work is waiting for operator assignment."
    if task.delay_probability and task.delay_probability > 0.65:
        return "Current workload and task risk indicate a likely delay unless the queue is reduced."
    if task.status == "delayed":
        return "The task is already marked delayed and needs active recovery."
    return "The task is still on schedule based on current signals."


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


def get_task_assistant(
    db: Session,
    company_id: UUID,
    task_id: UUID,
) -> dict:
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
    ).first()
    if not task:
        return {"error": "Task not found"}

    estimated_hours = _estimate_task_duration_hours(db, company_id, task)
    eta = _task_eta(task, estimated_hours)
    media = db.query(TaskImage).filter(TaskImage.task_id == task.id).all()
    notes = db.query(TaskLog).filter(
        TaskLog.task_id == task.id,
        TaskLog.action == "note_added",
    ).count()

    media_count = len(media)
    video_count = sum(1 for item in media if item.storage_key.lower().endswith((".mp4", ".webm", ".mov")))
    evidence_feedback = []
    if task.status in ("in_progress", "delayed") and media_count == 0:
        evidence_feedback.append("No work evidence uploaded yet. Capture a setup photo or clip before the next stage.")
    elif media_count < 2 and task.status in ACTIVE_TASK_STATUSES:
        evidence_feedback.append("Add one more media update so supervisors and clients can verify progress remotely.")
    else:
        evidence_feedback.append("Work evidence coverage looks healthy for this task.")

    if notes == 0 and task.status in ("in_progress", "paused", "delayed"):
        evidence_feedback.append("Add a short progress note so the next shift has context.")
    if task.priority in ("high", "critical") and video_count == 0:
        evidence_feedback.append("A short walkthrough clip would help validate the current setup for high-priority work.")

    due_status = "on_track"
    due_message = "Task is operating within its expected window."
    if eta and task.status != "completed":
        remaining = eta - _now()
        if remaining.total_seconds() < 0:
            due_status = "overdue"
            due_message = "This task is past its expected completion window. Escalate blockers now."
        elif remaining <= timedelta(hours=2):
            due_status = "due_soon"
            due_message = "This task is entering its final delivery window."

    instructions = generate_instruction_draft(
        task.title,
        machine_name=task.machine.name if task.machine else None,
        priority=task.priority,
        description=task.description,
    )
    result = {
        "task_id": str(task.id),
        "workflow": " -> ".join(
            [f"Step {index + 1}" for index in range(len(instructions["steps"]))]
        ),
        "steps": instructions["steps"],
        "quality_checks": instructions["quality_checks"],
        "expected_completion_hours": estimated_hours,
        "expected_completion_label": _format_hours(estimated_hours),
        "progress_percent": _task_progress(task, estimated_hours),
        "due_status": due_status,
        "due_message": due_message,
        "evidence_feedback": evidence_feedback,
        "voice_input_hint": "Use voice notes to log blockers or handoff updates without leaving the machine.",
        "time_tracking": {
            "total_time_spent_seconds": task.total_time_spent_seconds,
            "timer_running": task.timer_started_at is not None,
        },
    }

    llm_payload = generate_task_assistant_with_openrouter({
        "task": {
            "id": str(task.id),
            "title": task.title,
            "description": task.description,
            "status": task.status,
            "priority": task.priority,
            "machine_name": task.machine.name if task.machine else None,
        },
        "execution": {
            "expected_completion_label": result["expected_completion_label"],
            "progress_percent": result["progress_percent"],
            "due_status": result["due_status"],
            "due_message": result["due_message"],
            "total_time_spent_seconds": task.total_time_spent_seconds,
            "media_count": media_count,
            "notes_count": notes,
        },
        "fallback": {
            "workflow": result["workflow"],
            "steps": result["steps"],
            "evidence_feedback": result["evidence_feedback"],
            "voice_input_hint": result["voice_input_hint"],
        },
    })
    if llm_payload:
        result["workflow"] = str(llm_payload.get("workflow") or result["workflow"])
        result["steps"] = _string_list(llm_payload.get("steps")) or result["steps"]
        result["due_message"] = str(llm_payload.get("due_message") or result["due_message"])
        result["evidence_feedback"] = _string_list(llm_payload.get("evidence_feedback")) or result["evidence_feedback"]
        result["voice_input_hint"] = str(llm_payload.get("voice_input_hint") or result["voice_input_hint"])

    return result


def get_supervisor_intelligence(
    db: Session,
    company_id: UUID,
    *,
    task_id: UUID | None = None,
) -> dict:
    overdue_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.status.in_(ACTIVE_TASK_STATUSES),
        Task.estimated_completion.isnot(None),
        Task.estimated_completion < _now(),
    ).all()
    idle_operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
        User.is_on_duty == True,
        User.current_task_count == 0,
    ).order_by(User.full_name.asc()).all()

    task = None
    assignment_suggestion = None
    delay_prediction = None
    instruction_draft = None
    if task_id:
        task = db.query(Task).filter(
            Task.id == task_id,
            Task.company_id == company_id,
        ).first()
        if task:
            assignment_suggestion = _get_assignment_suggestion(db, company_id, task)
            delay_prediction = predict_delay(db, company_id, task.id)
            instruction_draft = generate_instruction_draft(
                task.title,
                machine_name=task.machine.name if task.machine else None,
                priority=task.priority,
                description=task.description,
            )

    bottleneck = _get_bottleneck_machine(db, company_id)
    workload = _get_operator_workload(db, company_id)
    alerts = []
    if overdue_tasks:
        alerts.append(f"{len(overdue_tasks)} tasks are overdue and need intervention.")
    if idle_operators:
        alerts.append(f"{len(idle_operators)} operators are on duty but currently idle.")
    if bottleneck:
        alerts.append(bottleneck["message"])
    if not alerts:
        alerts.append("No major execution blockers detected right now.")

    result = {
        "alerts": alerts,
        "overdue_tasks": [
            {
                "task_id": str(item.id),
                "title": item.title,
                "priority": item.priority,
                "estimated_completion": item.estimated_completion.isoformat() if item.estimated_completion else None,
            }
            for item in overdue_tasks[:5]
        ],
        "idle_operators": [
            {
                "user_id": str(operator.id),
                "full_name": operator.full_name,
            }
            for operator in idle_operators[:5]
        ],
        "assignment_suggestion": assignment_suggestion,
        "delay_prediction": delay_prediction,
        "bottleneck": bottleneck,
        "operator_workload": workload[:6],
        "instruction_draft": instruction_draft,
    }
    llm_payload = generate_supervisor_intelligence_with_openrouter({
        "task": {
            "id": str(task.id) if task else None,
            "title": task.title if task else None,
            "priority": task.priority if task else None,
            "status": task.status if task else None,
        },
        "alerts": result["alerts"],
        "overdue_tasks": result["overdue_tasks"],
        "idle_operators": result["idle_operators"],
        "assignment_suggestion": result["assignment_suggestion"],
        "delay_prediction": result["delay_prediction"],
        "bottleneck": result["bottleneck"],
        "instruction_draft": result["instruction_draft"],
    })
    if llm_payload:
        result["alerts"] = _string_list(llm_payload.get("alerts")) or result["alerts"]
        if result["assignment_suggestion"] and llm_payload.get("assignment_message"):
            result["assignment_suggestion"]["message"] = str(llm_payload["assignment_message"])
        if result["bottleneck"] and llm_payload.get("bottleneck_summary"):
            result["bottleneck"]["message"] = str(llm_payload["bottleneck_summary"])
        if result["instruction_draft"] and llm_payload.get("instruction_draft_summary"):
            result["instruction_draft"]["summary"] = str(llm_payload["instruction_draft_summary"])
    return result


def get_owner_intelligence(db: Session, company_id: UUID) -> dict:
    total_tasks = db.query(Task).filter(Task.company_id == company_id).count()
    delayed_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.status == "delayed",
    ).count()
    active_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.status.in_(ACTIVE_TASK_STATUSES),
    ).count()
    active_operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
        User.is_on_duty == True,
    ).count()
    offline_operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
        User.is_on_duty == False,
    ).count()
    completed_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.status == "completed",
        Task.actual_completion.isnot(None),
    ).all()

    delayed_ratio = delayed_tasks / total_tasks if total_tasks else 0
    active_operator_base = max(active_operators + offline_operators, 1)
    offline_ratio = offline_operators / active_operator_base
    projected_change = round(-((delayed_ratio * 20) + (offline_ratio * 8)), 1)

    avg_hours = None
    if completed_tasks:
        avg_hours = sum(
            (item.actual_completion - item.created_at).total_seconds() / 3600
            for item in completed_tasks
            if item.actual_completion
        ) / len(completed_tasks)

    estimated_cost = round((avg_hours or 2.5) * 180, 2)
    bottleneck = _get_bottleneck_machine(db, company_id)
    workload = _get_operator_workload(db, company_id)
    overloaded = [item for item in workload if item["current_task_count"] >= MAX_TASKS_PER_OPERATOR]
    underutilized = [item for item in workload if item["is_on_duty"] and item["current_task_count"] == 0]
    reassign_count = min(len(overloaded), len(underutilized))
    latest_report = db.query(Report).filter(
        Report.company_id == company_id
    ).order_by(Report.created_at.desc()).first()

    top_issue = "delay accumulation in active work"
    if bottleneck:
        top_issue = f"congestion around {bottleneck['machine_name']}"
    elif not delayed_tasks and active_tasks:
        top_issue = "unassigned and queued work handoffs"
    elif total_tasks == 0:
        top_issue = "insufficient production data"

    anomalies = []
    if delayed_ratio >= 0.25:
        anomalies.append("Delayed work has crossed 25% of all tracked tasks.")
    if bottleneck and bottleneck["average_delay_risk"] >= 0.55:
        anomalies.append(f"{bottleneck['machine_name']} is showing elevated delay risk.")
    if offline_operators >= 2:
        anomalies.append("Multiple operators are off duty, which may reduce next-shift throughput.")
    if latest_report is None:
        anomalies.append("No formal report has been generated yet for leadership review.")

    recommendations = []
    if reassign_count > 0:
        impact = min(8 + (reassign_count * 5), 22)
        recommendations.append(f"Reassign {reassign_count} operators to relieve overloaded queues and recover about {impact}% output.")
    if bottleneck:
        recommendations.append(f"Prioritize queue reduction on {bottleneck['machine_name']} before adding new work.")
    if not recommendations:
        recommendations.append("Keep the current staffing mix and monitor delay risk for the next reporting cycle.")

    result = {
        "forecast": {
            "next_week_output_change_percent": projected_change,
            "summary": (
                f"Production output is projected to {'drop' if projected_change < 0 else 'improve'} "
                f"{abs(projected_change):.1f}% next week based on current delays and operator coverage."
            ),
        },
        "optimization": {
            "recommended_reassignments": reassign_count,
            "summary": recommendations[0],
        },
        "cost_analysis": {
            "estimated_cost_per_task_inr": estimated_cost,
            "average_task_hours": round(avg_hours, 2) if avg_hours else None,
        },
        "report_summary": (
            f"Top issue: {top_issue}. "
            f"Latest formal report: {latest_report.title if latest_report else 'not generated yet'}."
        ),
        "anomalies": anomalies,
        "recommendations": recommendations,
    }
    llm_payload = generate_owner_intelligence_with_openrouter({
        "metrics": {
            "total_tasks": total_tasks,
            "delayed_tasks": delayed_tasks,
            "active_tasks": active_tasks,
            "active_operators": active_operators,
            "offline_operators": offline_operators,
            "projected_change_percent": projected_change,
            "estimated_cost_per_task_inr": estimated_cost,
        },
        "bottleneck": bottleneck,
        "fallback": result,
    })
    if llm_payload:
        result["forecast"]["summary"] = str(llm_payload.get("forecast_summary") or result["forecast"]["summary"])
        result["optimization"]["summary"] = str(llm_payload.get("optimization_summary") or result["optimization"]["summary"])
        result["report_summary"] = str(llm_payload.get("report_summary") or result["report_summary"])
        result["anomalies"] = _string_list(llm_payload.get("anomalies")) or result["anomalies"]
        result["recommendations"] = _string_list(llm_payload.get("recommendations")) or result["recommendations"]
    return result


def get_client_progress_summary(
    db: Session,
    company_id: UUID,
    task_id: UUID,
    client_id: UUID,
) -> dict:
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == company_id,
        Task.client_id == client_id,
    ).first()
    if not task:
        return {"error": "Task not found"}

    estimated_hours = _estimate_task_duration_hours(db, company_id, task)
    progress_percent = _task_progress(task, estimated_hours)
    eta = _task_eta(task, estimated_hours)
    schedule_status = "on_schedule"
    if task.status == "completed":
        schedule_status = "completed"
    elif eta and eta < _now():
        schedule_status = "delayed"
    elif task.delay_probability and task.delay_probability > 0.6:
        schedule_status = "at_risk"

    task_logs = db.query(TaskLog).filter(TaskLog.task_id == task.id).order_by(TaskLog.created_at.desc()).all()
    milestones = [
        {
            "action": log.action,
            "details": log.details,
            "created_at": log.created_at.isoformat(),
        }
        for log in task_logs[:5]
    ]
    media_count = db.query(TaskImage).filter(TaskImage.task_id == task.id).count()
    delivery_prediction = eta.isoformat() if eta else None
    summary = f"Your project is {progress_percent}% complete and "
    if schedule_status == "completed":
        summary += "has been completed."
    elif schedule_status == "delayed":
        summary += "is currently behind schedule."
    elif schedule_status == "at_risk":
        summary += "is moving, but carries a delivery risk."
    else:
        summary += "is on schedule."

    result = {
        "task_id": str(task.id),
        "progress_percent": progress_percent,
        "schedule_status": schedule_status,
        "summary": summary,
        "delay_explanation": _task_delay_explanation(task),
        "delivery_prediction": delivery_prediction,
        "eta_label": eta.isoformat() if eta else None,
        "media_count": media_count,
        "milestones": milestones,
    }
    llm_payload = generate_client_summary_with_openrouter({
        "task": {
            "id": str(task.id),
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
        },
        "progress": {
            "progress_percent": progress_percent,
            "schedule_status": schedule_status,
            "delay_reason": task.delay_reason,
            "delivery_prediction": delivery_prediction,
            "media_count": media_count,
        },
        "fallback": {
            "summary": result["summary"],
            "delay_explanation": result["delay_explanation"],
        },
    })
    if llm_payload:
        result["summary"] = str(llm_payload.get("summary") or result["summary"])
        result["delay_explanation"] = str(llm_payload.get("delay_explanation") or result["delay_explanation"])
        if llm_payload.get("delivery_prediction_note"):
            result["delivery_prediction_note"] = str(llm_payload["delivery_prediction_note"])
    return result


def answer_company_question(
    db: Session,
    company_id: UUID,
    prompt: str,
) -> dict:
    text = prompt.strip().lower()
    workload = _get_operator_workload(db, company_id)
    bottleneck = _get_bottleneck_machine(db, company_id)
    owner_intelligence = get_owner_intelligence(db, company_id)
    delayed_count = db.query(Task).filter(
        Task.company_id == company_id,
        Task.status == "delayed",
    ).count()

    llm_payload = answer_global_question_with_openrouter({
        "question": prompt,
        "owner_intelligence": owner_intelligence,
        "bottleneck": bottleneck,
        "workload": workload[:8],
        "delayed_count": delayed_count,
    })
    if llm_payload:
        answer = str(llm_payload.get("answer") or "").strip()
        if answer:
            return {
                "answer": answer,
                "highlights": _string_list(llm_payload.get("highlights")),
                "suggested_questions": _string_list(llm_payload.get("suggested_questions")) or [
                    "Which operator is most efficient?",
                    "Why are tasks delayed?",
                    "Which machine is the current bottleneck?",
                ],
            }

    if "efficient" in text or "best operator" in text or "fastest operator" in text:
        ranked = [item for item in workload if item["efficiency_score"] is not None]
        ranked.sort(key=lambda item: item["efficiency_score"], reverse=True)
        if ranked:
            best = ranked[0]
            answer = f"{best['full_name']} is currently the most efficient tracked operator at {best['efficiency_score']:.1f}%."
            highlights = [f"Current workload: {best['current_task_count']}/{MAX_TASKS_PER_OPERATOR}"]
        else:
            answer = "There is not enough completed-work history yet to rank operator efficiency."
            highlights = []
    elif "delay" in text or "why" in text:
        answer = f"There are {delayed_count} delayed tasks right now."
        if bottleneck:
            answer += f" The biggest pressure point is {bottleneck['machine_name']}."
        highlights = owner_intelligence["anomalies"][:3]
    elif "machine" in text or "bottleneck" in text:
        if bottleneck:
            answer = bottleneck["message"]
            highlights = [f"Average delay risk: {int(bottleneck['average_delay_risk'] * 100)}%"]
        else:
            answer = "No machine bottleneck is currently standing out."
            highlights = []
    elif "cost" in text:
        cost = owner_intelligence["cost_analysis"]
        answer = f"Estimated cost per task is about INR {cost['estimated_cost_per_task_inr']:.2f}."
        highlights = [f"Average task time: {_format_hours(cost['average_task_hours'])}"]
    elif "output" in text or "productivity" in text or "next week" in text:
        forecast = owner_intelligence["forecast"]
        answer = forecast["summary"]
        highlights = owner_intelligence["recommendations"][:3]
    else:
        answer = owner_intelligence["report_summary"]
        highlights = owner_intelligence["recommendations"][:3]

    return {
        "answer": answer,
        "highlights": highlights,
        "suggested_questions": [
            "Which operator is most efficient?",
            "Why are tasks delayed?",
            "Which machine is the current bottleneck?",
        ],
    }
