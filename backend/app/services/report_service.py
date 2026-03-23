"""
MechTrack Pulse — Report Service

Generates reports from task data with logs, completion times, and AI insights.
"""

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.task import Task
from app.models.task_log import TaskLog
from app.models.ai_insight import AIInsight
from app.models.report import Report


def generate_report(
    db: Session,
    company_id: UUID,
    generated_by: UUID,
    report_type: str,
    title: str,
    period_start: datetime,
    period_end: datetime,
) -> dict:
    """
    Generate a report covering the specified period.
    Aggregates: task stats, completion times, delays, AI insights.
    """
    # ── Task Statistics ──────────────────────────────────
    tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.created_at >= period_start,
        Task.created_at <= period_end,
    ).all()

    total_tasks = len(tasks)
    completed = sum(1 for t in tasks if t.status == "completed")
    delayed = sum(1 for t in tasks if t.status == "delayed")
    in_progress = sum(1 for t in tasks if t.status == "in_progress")
    idle = sum(1 for t in tasks if t.status == "idle")

    # Completion times
    completion_times = []
    for t in tasks:
        if t.status == "completed" and t.actual_completion:
            hours = (t.actual_completion - t.created_at).total_seconds() / 3600
            completion_times.append(hours)

    avg_completion = (
        sum(completion_times) / len(completion_times) if completion_times else None
    )

    # Priority breakdown
    priority_breakdown = {}
    for t in tasks:
        priority_breakdown[t.priority] = priority_breakdown.get(t.priority, 0) + 1

    # ── Task Logs ────────────────────────────────────────
    task_ids = [t.id for t in tasks]
    log_count = 0
    if task_ids:
        log_count = db.query(TaskLog).filter(
            TaskLog.task_id.in_(task_ids)
        ).count()

    # ── AI Insights ──────────────────────────────────────
    insights = db.query(AIInsight).filter(
        AIInsight.company_id == company_id,
        AIInsight.created_at >= period_start,
        AIInsight.created_at <= period_end,
    ).all()

    insight_summary = {
        "total": len(insights),
        "critical": sum(1 for i in insights if i.severity == "critical"),
        "warning": sum(1 for i in insights if i.severity == "warning"),
        "info": sum(1 for i in insights if i.severity == "info"),
    }

    # ── Save Report Record ───────────────────────────────
    report = Report(
        company_id=company_id,
        report_type=report_type,
        title=title,
        generated_by=generated_by,
        period_start=period_start,
        period_end=period_end,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return {
        "report_id": str(report.id),
        "title": title,
        "report_type": report_type,
        "period": {
            "start": str(period_start),
            "end": str(period_end),
        },
        "task_summary": {
            "total": total_tasks,
            "completed": completed,
            "delayed": delayed,
            "in_progress": in_progress,
            "idle": idle,
            "completion_rate": f"{(completed/total_tasks*100):.1f}%" if total_tasks > 0 else "N/A",
        },
        "completion_time": {
            "average_hours": round(avg_completion, 2) if avg_completion else None,
            "fastest_hours": round(min(completion_times), 2) if completion_times else None,
            "slowest_hours": round(max(completion_times), 2) if completion_times else None,
        },
        "priority_breakdown": priority_breakdown,
        "total_task_logs": log_count,
        "ai_insights": insight_summary,
        "generated_at": str(report.created_at),
    }


def list_reports(db: Session, company_id: UUID) -> list[dict]:
    """List all reports for a company."""
    reports = db.query(Report).filter(
        Report.company_id == company_id,
    ).order_by(Report.created_at.desc()).all()

    return [
        {
            "id": str(r.id),
            "title": r.title,
            "report_type": r.report_type,
            "period_start": str(r.period_start),
            "period_end": str(r.period_end),
            "generated_by": str(r.generated_by),
            "created_at": str(r.created_at),
        }
        for r in reports
    ]
