"""
MechTrack Pulse — Client Router

Endpoints for the Client portal.
Only Accessible by users with the 'client' role.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles
from app.db.database import get_db
from app.models.task import Task
from app.schemas.task import TaskResponse, TaskLogResponse
from app.services.task_service import get_task_logs

router = APIRouter()

@router.get("/jobs", response_model=list[TaskResponse])
def get_client_jobs(
    current_user=Depends(require_roles("client")),
    db: Session = Depends(get_db)
):
    """
    Client Dashboard: Get all jobs (tasks) specific to this client.
    Returns read-only tracking view.
    """
    return db.query(Task).filter(
        Task.company_id == current_user.company_id,
        Task.client_id == current_user.id
    ).order_by(Task.created_at.desc()).all()


@router.get("/jobs/{task_id}/timeline", response_model=list[TaskLogResponse])
def get_job_timeline(
    task_id: str,
    current_user=Depends(require_roles("client")),
    db: Session = Depends(get_db)
):
    """
    Job Tracking: Get real-time updates and logs (timeline) for a specific job.
    """
    # Verify job belongs to client
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
        Task.client_id == current_user.id
    ).first()
    
    if not task:
        return []

    return get_task_logs(db, current_user.company_id, task.id)
