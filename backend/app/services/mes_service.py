"""
MechTrack Pulse — MES Helper Service

Shared helpers for CNC/MES workflows so route handlers can enforce consistent
rules around locking, stage progression, and audit persistence.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.ai_report import AIReport
from app.models.assignment import Assignment
from app.models.job_process import JobProcess
from app.models.job_spec import JobSpec
from app.models.job_version import JobVersion
from app.models.production_log import ProductionLog
from app.models.rework_log import ReworkLog
from app.models.task import Task


MES_ACTIVE_STATUSES = (
    "idle",
    "queued",
    "created",
    "planned",
    "ready",
    "assigned",
    "setup",
    "setup_done",
    "first_piece_approval",
    "in_progress",
    "paused",
    "qc_check",
    "final_inspection",
    "submitted_for_review",
    "dispatched",
    "delayed",
)

CNC_EXECUTION_STATUSES = {
    "setup",
    "setup_done",
    "first_piece_approval",
    "in_progress",
    "qc_check",
    "final_inspection",
    "submitted_for_review",
    "dispatched",
    "completed",
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def is_cnc_job(task: Task | None) -> bool:
    if task is None:
        return False
    return bool(
        task.is_locked
        or task.part_name
        or task.material_type
        or task.material_batch
        or task.drawing_url
        or task.status in {
            "created",
            "planned",
            "ready",
            "assigned",
            "setup",
            "setup_done",
            "first_piece_approval",
            "qc_check",
            "final_inspection",
            "submitted_for_review",
            "dispatched",
        }
    )


def has_locked_process_plan(db: Session, company_id: UUID, task_id: UUID) -> bool:
    return (
        db.query(JobProcess)
        .filter(
            JobProcess.company_id == company_id,
            JobProcess.task_id == task_id,
            JobProcess.is_locked == True,
        )
        .count()
        > 0
    )


def build_spec_snapshot(db: Session, company_id: UUID, task_id: UUID) -> list[dict]:
    specs = (
        db.query(JobSpec)
        .filter(
            JobSpec.company_id == company_id,
            JobSpec.task_id == task_id,
        )
        .order_by(JobSpec.field_name.asc())
        .all()
    )
    return [
        {
            "field_name": spec.field_name,
            "ai_value": spec.ai_value,
            "human_value": spec.human_value,
            "confirmed_value": spec.human_value if spec.is_confirmed else spec.ai_value,
            "unit": spec.unit,
            "is_confirmed": spec.is_confirmed,
            "ai_confidence": spec.ai_confidence,
        }
        for spec in specs
    ]


def build_process_snapshot(db: Session, company_id: UUID, task_id: UUID) -> list[dict]:
    operations = (
        db.query(JobProcess)
        .filter(
            JobProcess.company_id == company_id,
            JobProcess.task_id == task_id,
        )
        .order_by(JobProcess.sequence_order.asc())
        .all()
    )
    return [
        {
            "sequence_order": op.sequence_order,
            "operation_name": op.operation_name,
            "machine_id": str(op.machine_id) if op.machine_id else None,
            "tool_required": op.tool_required,
            "cycle_time_minutes": op.cycle_time_minutes,
            "notes": op.notes,
            "is_ai_suggested": op.is_ai_suggested,
            "is_locked": op.is_locked,
        }
        for op in operations
    ]


def create_job_version(
    db: Session,
    *,
    company_id: UUID,
    task_id: UUID,
    created_by: UUID | None,
    version_type: str,
    snapshot: dict,
) -> JobVersion:
    existing_count = (
        db.query(JobVersion)
        .filter(
            JobVersion.company_id == company_id,
            JobVersion.task_id == task_id,
        )
        .count()
    )
    version = JobVersion(
        company_id=company_id,
        task_id=task_id,
        created_by=created_by,
        version_number=existing_count + 1,
        version_type=version_type,
        snapshot=snapshot,
    )
    db.add(version)
    return version


def record_ai_report(
    db: Session,
    *,
    company_id: UUID,
    task_id: UUID,
    stage: str,
    status: str,
    confidence: float | None,
    suggestion: str | None,
    decision: str | None = None,
    payload: dict | None = None,
) -> AIReport:
    report = AIReport(
        company_id=company_id,
        task_id=task_id,
        stage=stage,
        status=status,
        confidence=confidence,
        suggestion=suggestion,
        decision=decision,
        payload=payload or {},
    )
    db.add(report)
    return report


def record_assignment(
    db: Session,
    *,
    company_id: UUID,
    task_id: UUID,
    operator_id: UUID | None,
    machine_id: UUID | None,
    assigned_by: UUID | None,
    assignment_type: str = "initial",
    ai_recommended: bool = False,
    notes: str | None = None,
) -> Assignment:
    assignment = Assignment(
        company_id=company_id,
        task_id=task_id,
        operator_id=operator_id,
        machine_id=machine_id,
        assigned_by=assigned_by,
        assignment_type=assignment_type,
        ai_recommended=ai_recommended,
        notes=notes,
    )
    db.add(assignment)
    return assignment


def record_rework(
    db: Session,
    *,
    company_id: UUID,
    task_id: UUID,
    iteration: int,
    triggered_by: UUID | None,
    reason: str | None,
    ai_recommendation: dict | None,
) -> ReworkLog:
    rework = ReworkLog(
        company_id=company_id,
        task_id=task_id,
        iteration=iteration,
        triggered_by=triggered_by,
        reason=reason,
        ai_recommendation=ai_recommendation or {},
    )
    db.add(rework)
    return rework


def get_production_totals(db: Session, company_id: UUID, task_id: UUID) -> dict[str, int]:
    logs = (
        db.query(ProductionLog)
        .filter(
            ProductionLog.company_id == company_id,
            ProductionLog.task_id == task_id,
        )
        .all()
    )
    return {
        "produced_qty": sum(item.produced_qty or 0 for item in logs),
        "rejected_qty": sum(item.rejected_qty or 0 for item in logs),
        "downtime_minutes": sum(item.downtime_minutes or 0 for item in logs),
        "log_count": len(logs),
    }
