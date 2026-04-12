"""
MechTrack Pulse — Owner Service

Aggregations for KPI dashboard and report generation.
"""

from uuid import UUID
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.company import Company
from app.models.report import Report
from app.models.task import Task
from app.models.machine import Machine
from app.models.user import User
from app.models.subscription import Subscription
from app.services.audit_service import record_audit_log
from app.schemas.owner import (
    CompanyProfileResponse,
    KPIDashboardResponse,
    MachineOperationsSummaryResponse,
    OwnerBusinessOverviewResponse,
    ReportsSummaryResponse,
    SubscriptionSummaryResponse,
    TaskOperationsSummaryResponse,
    TeamCompositionResponse,
    UpdateCompanyProfileRequest,
    UsageMetricResponse,
    WatchlistSummaryResponse,
)

import pandas as pd
import io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter


ACTIVE_TASK_STATUSES = ("idle", "queued", "in_progress", "paused", "delayed")


def _usage_metric(used: int, limit: int) -> UsageMetricResponse:
    if limit == -1:
        return UsageMetricResponse(
            used=used,
            limit=limit,
            remaining=None,
            utilization_percent=None,
        )

    remaining = max(limit - used, 0)
    utilization = round((used / limit) * 100, 1) if limit > 0 else 0.0
    return UsageMetricResponse(
        used=used,
        limit=limit,
        remaining=remaining,
        utilization_percent=utilization,
    )


def _normalize_optional(value: str | None) -> str | None:
    if value is None:
        return None
    cleaned = value.strip()
    return cleaned or None


def get_company_profile(db: Session, company_id: UUID) -> CompanyProfileResponse:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise ValueError("Company not found")
    return CompanyProfileResponse.model_validate(company)


def update_company_profile(
    db: Session,
    company_id: UUID,
    payload: UpdateCompanyProfileRequest,
    *,
    actor: User | None = None,
) -> CompanyProfileResponse:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise ValueError("Company not found")

    if payload.gst_number:
        existing = db.query(Company).filter(
            Company.gst_number == payload.gst_number,
            Company.id != company_id,
        ).first()
        if existing:
            raise ValueError("A company with this GST number already exists")

    company.name = payload.name.strip()
    company.gst_number = _normalize_optional(payload.gst_number)
    company.msme_number = _normalize_optional(payload.msme_number)
    company.industry_type = _normalize_optional(payload.industry_type)
    company.address = _normalize_optional(payload.address)
    company.city = _normalize_optional(payload.city)
    company.state = _normalize_optional(payload.state)

    record_audit_log(
        db,
        company_id=company_id,
        actor=actor,
        action="company.profile_updated",
        resource_type="company",
        resource_id=company.id,
        details={
            "name": company.name,
            "industry_type": company.industry_type,
            "city": company.city,
            "state": company.state,
        },
    )
    db.commit()
    db.refresh(company)
    return CompanyProfileResponse.model_validate(company)


def get_business_overview(db: Session, company_id: UUID) -> OwnerBusinessOverviewResponse:
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise ValueError("Company not found")

    subscription = db.query(Subscription).filter(
        Subscription.company_id == company_id
    ).first()
    if not subscription:
        raise ValueError("Subscription not found")

    task_counts = dict(
        db.query(Task.status, func.count(Task.id))
        .filter(Task.company_id == company_id)
        .group_by(Task.status)
        .all()
    )
    total_tasks = sum(task_counts.values())
    completed_tasks = task_counts.get("completed", 0)
    delayed_tasks = task_counts.get("delayed", 0)
    completion_rate = round((completed_tasks / total_tasks) * 100, 1) if total_tasks else 0.0

    machine_counts = dict(
        db.query(Machine.status, func.count(Machine.id))
        .filter(Machine.company_id == company_id)
        .group_by(Machine.status)
        .all()
    )

    active_user_count = db.query(User).filter(
        User.company_id == company_id,
        User.is_active == True,
    ).count()
    supervisor_count = db.query(User).filter(
        User.company_id == company_id,
        User.role == "supervisor",
        User.is_active == True,
    ).count()
    operator_count = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
    ).count()
    client_count = db.query(User).filter(
        User.company_id == company_id,
        User.role == "client",
        User.is_active == True,
    ).count()
    active_operator_count = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
        User.is_on_duty == True,
    ).count()
    offline_operator_count = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
        User.is_on_duty == False,
    ).count()

    machine_total = sum(machine_counts.values())
    reports_total = db.query(Report).filter(Report.company_id == company_id).count()
    latest_report = db.query(Report).filter(
        Report.company_id == company_id
    ).order_by(Report.created_at.desc()).first()

    high_risk_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.status.in_(ACTIVE_TASK_STATUSES),
        Task.delay_probability > 0.5,
    ).count()
    unassigned_tasks = db.query(Task).filter(
        Task.company_id == company_id,
        Task.status.in_(ACTIVE_TASK_STATUSES),
        Task.assigned_to.is_(None),
    ).count()
    overloaded_operators = db.query(User).filter(
        User.company_id == company_id,
        User.role == "operator",
        User.is_active == True,
        User.current_task_count >= 5,
    ).count()

    return OwnerBusinessOverviewResponse(
        company=CompanyProfileResponse.model_validate(company),
        subscription=SubscriptionSummaryResponse(
            plan=subscription.plan,
            payment_status=subscription.payment_status,
            ai_enabled=subscription.ai_enabled,
            started_at=subscription.started_at,
            expires_at=subscription.expires_at,
            usage={
                "users": _usage_metric(active_user_count, subscription.max_users),
                "machines": _usage_metric(machine_total, subscription.max_machines),
                "tasks": _usage_metric(subscription.current_usage_tasks, subscription.max_tasks_per_month),
            },
        ),
        tasks=TaskOperationsSummaryResponse(
            total=total_tasks,
            completed=completed_tasks,
            delayed=delayed_tasks,
            in_progress=task_counts.get("in_progress", 0),
            idle=task_counts.get("idle", 0),
            queued=task_counts.get("queued", 0),
            paused=task_counts.get("paused", 0),
            completion_rate=completion_rate,
        ),
        machines=MachineOperationsSummaryResponse(
            total=machine_total,
            active=machine_counts.get("active", 0),
            idle=machine_counts.get("idle", 0),
            maintenance=machine_counts.get("maintenance", 0),
        ),
        team=TeamCompositionResponse(
            total_active_users=active_user_count,
            supervisors=supervisor_count,
            operators=operator_count,
            clients=client_count,
            active_operators=active_operator_count,
            offline_operators=offline_operator_count,
        ),
        reports=ReportsSummaryResponse(
            total_reports=reports_total,
            latest_generated_at=latest_report.created_at if latest_report else None,
        ),
        watchlist=WatchlistSummaryResponse(
            high_risk_tasks=high_risk_tasks,
            unassigned_tasks=unassigned_tasks,
            overloaded_operators=overloaded_operators,
        ),
    )


def get_kpi_dashboard(db: Session, company_id: UUID) -> KPIDashboardResponse:
    # Task Counts
    tasksQuery = db.query(Task.status, func.count(Task.id)).filter(Task.company_id == company_id).group_by(Task.status).all()
    counts = {k: v for k, v in tasksQuery}
    
    total_tasks = sum(counts.values()) or 1 # prevent zero div
    completed = counts.get("completed", 0)
    delayed = counts.get("delayed", 0)
    in_progress = counts.get("in_progress", 0)
    
    # Machine Counts
    machinesQuery = db.query(Machine.status, func.count(Machine.id)).filter(Machine.company_id == company_id).group_by(Machine.status).all()
    mac_counts = {k: v for k, v in machinesQuery}
    
    total_machines = sum(mac_counts.values())
    active_machines = mac_counts.get("running", 0) + mac_counts.get("idle", 0)

    # Operator Counts
    active_operators = db.query(User).filter(
        User.company_id == company_id, User.role == "operator", User.is_on_duty == True
    ).count()

    return KPIDashboardResponse(
        total_tasks=total_tasks if sum(counts.values()) > 0 else 0,
        completed_tasks=completed,
        delayed_tasks=delayed,
        in_progress_tasks=in_progress,
        productivity_percent=round((completed / total_tasks) * 100, 2),
        delay_percent=round((delayed / total_tasks) * 100, 2),
        total_machines=total_machines,
        active_machines=active_machines,
        active_operators=active_operators
    )

def generate_task_csv(db: Session, company_id: UUID) -> str:
    """Generate a CSV string of all tasks for Excel export."""
    tasks = db.query(Task).filter(Task.company_id == company_id).all()
    
    data = []
    for t in tasks:
        data.append({
            "Task ID": str(t.id),
            "Title": t.title,
            "Status": t.status,
            "Priority": t.priority,
            "Time Spent (Sec)": t.total_time_spent_seconds,
            "Delay Reason": t.delay_reason or "",
            "Created At": t.created_at.strftime("%Y-%m-%d %H:%M:%S")
        })
        
    df = pd.DataFrame(data)
    return df.to_csv(index=False)

def generate_task_pdf(db: Session, company_id: UUID) -> io.BytesIO:
    """Generate a simple PDF summary of tasks."""
    tasks = db.query(Task).filter(Task.company_id == company_id).limit(100).all()
    
    buffer = io.BytesIO()
    p = canvas.Canvas(buffer, pagesize=letter)
    
    p.setFont("Helvetica-Bold", 16)
    p.drawString(50, 750, "MechTrack Pulse — Task Report")
    
    p.setFont("Helvetica", 10)
    y = 700
    for idx, t in enumerate(tasks):
        if y < 50:
            p.showPage()
            y = 750
        text = f"{t.title} | Status: {t.status} | Time: {t.total_time_spent_seconds}s | Delay: {t.delay_reason or 'None'}"
        p.drawString(50, y, text)
        y -= 20
        
    p.save()
    buffer.seek(0)
    return buffer
