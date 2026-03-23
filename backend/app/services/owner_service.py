"""
MechTrack Pulse — Owner Service

Aggregations for KPI dashboard and report generation.
"""

from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.task import Task
from app.models.machine import Machine
from app.models.user import User
from app.schemas.owner import KPIDashboardResponse

import pandas as pd
import io
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

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
