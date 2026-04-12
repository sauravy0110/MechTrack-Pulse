import csv
import io

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse, StreamingResponse
from sqlalchemy.orm import Session
from app.core.dependencies import require_roles
from app.db.database import get_db
from app.models.task import Task
from app.schemas.task import TaskResponse, TaskLogResponse
from app.services.task_service import get_task_logs
from app.services.ai_service import get_client_progress_summary

from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas

router = APIRouter()


@router.get("/jobs", response_model=list[TaskResponse])
def get_client_jobs(
    limit: int = 20,
    offset: int = 0,
    status: str | None = None,
    current_user=Depends(require_roles("client")),
    db: Session = Depends(get_db)
):
    query = db.query(Task).filter(
        Task.company_id == current_user.company_id,
        Task.client_id == current_user.id
    )

    if status:
        query = query.filter(Task.status == status)

    return query.order_by(Task.created_at.desc()).offset(offset).limit(limit).all()


@router.get("/jobs/{task_id}/timeline", response_model=list[TaskLogResponse])
def get_job_timeline(
    task_id: str,
    current_user=Depends(require_roles("client")),
    db: Session = Depends(get_db)
):
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
        Task.client_id == current_user.id
    ).first()

    if not task:
        raise HTTPException(status_code=404, detail="Job not found")

    return get_task_logs(db, current_user.company_id, task.id)


@router.get("/reports")
def get_client_reports(
    current_user=Depends(require_roles("client")),
    db: Session = Depends(get_db)
):
    tasks = db.query(Task).filter(
        Task.company_id == current_user.company_id,
        Task.client_id == current_user.id
    ).order_by(Task.updated_at.desc()).limit(25).all()

    reports = []
    for task in tasks:
        summary = get_client_progress_summary(db, current_user.company_id, task.id, current_user.id)
        reports.append({
            "task_id": str(task.id),
            "title": task.title,
            "status": task.status,
            "priority": task.priority,
            "progress_percent": summary.get("progress_percent", 0),
            "schedule_status": summary.get("schedule_status", "unknown"),
            "delivery_prediction": summary.get("delivery_prediction"),
            "updated_at": task.updated_at.isoformat(),
        })
    return reports


@router.get("/reports/export/csv", response_class=PlainTextResponse)
def export_client_reports_csv(
    current_user=Depends(require_roles("client")),
    db: Session = Depends(get_db)
):
    tasks = db.query(Task).filter(
        Task.company_id == current_user.company_id,
        Task.client_id == current_user.id
    ).order_by(Task.updated_at.desc()).all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["Task ID", "Title", "Status", "Priority", "Updated At"])
    for task in tasks:
        writer.writerow([
            str(task.id),
            task.title,
            task.status,
            task.priority,
            task.updated_at.isoformat(),
        ])

    return PlainTextResponse(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=client_project_reports.csv"},
    )


@router.get("/reports/export/pdf")
def export_client_reports_pdf(
    current_user=Depends(require_roles("client")),
    db: Session = Depends(get_db)
):
    tasks = db.query(Task).filter(
        Task.company_id == current_user.company_id,
        Task.client_id == current_user.id
    ).order_by(Task.updated_at.desc()).limit(50).all()

    buffer = io.BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=letter)
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(50, 760, "MechTrack Pulse — Client Project Report")

    pdf.setFont("Helvetica", 10)
    y = 730
    for task in tasks:
        if y < 60:
            pdf.showPage()
            y = 760
        pdf.drawString(50, y, f"{task.title} | {task.status} | Priority: {task.priority}")
        y -= 18

    pdf.save()
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=client_project_reports.pdf"},
    )
