"""
MechTrack Pulse — Image Upload API Routes

Endpoints:
  POST /api/v1/uploads/tasks/{task_id}/media   → Upload image or video for a task
  GET  /api/v1/uploads/tasks/{task_id}/media   → List task media
  POST /api/v1/uploads/tasks/{task_id}/images  → Backward-compatible alias
  GET  /api/v1/uploads/tasks/{task_id}/images  → Backward-compatible alias

Storage: Local filesystem (production would use S3/GCS)
"""

import os
import uuid as uuid_mod
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import require_password_changed
from app.db.database import get_db
from app.models.task import Task
from app.models.task_image import TaskImage
from app.models.task_log import TaskLog
from app.models.user import User
from app.services.audit_service import record_audit_log
from app.services.task_service import user_can_access_task

router = APIRouter()

# Local upload directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "uploads")


ALLOWED_MEDIA_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "video/mp4",
    "video/webm",
    "video/quicktime",
]


def _get_task_for_upload(db: Session, current_user: User, task_id: UUID) -> Task:
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not user_can_access_task(task, current_user):
        raise HTTPException(status_code=403, detail="You do not have access to this task")
    return task


def _serialize_media(item: TaskImage) -> dict:
    storage_key = (item.storage_key or "").lower()
    media_type = "video" if storage_key.endswith((".mp4", ".webm", ".mov")) else "image"
    return {
        "id": str(item.id),
        "task_id": str(item.task_id),
        "media_url": item.image_url,
        "image_url": item.image_url,
        "media_type": media_type,
        "file_name": item.storage_key,
        "file_size_bytes": item.file_size_bytes,
        "uploaded_by": str(item.uploaded_by),
        "uploaded_at": str(item.uploaded_at),
    }


def _save_upload_file(file: UploadFile) -> tuple[str, bytes]:
    ext = file.filename.split(".")[-1] if file.filename else "bin"
    storage_key = f"{uuid_mod.uuid4()}.{ext}"
    file_path = os.path.join(UPLOAD_DIR, storage_key)
    contents = file.file.read()
    with open(file_path, "wb") as handle:
        handle.write(contents)
    return storage_key, contents


def _upload_task_media(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """
    Upload an image or video for a task.
    Stored locally; returns the image metadata.
    """
    task = _get_task_for_upload(db, current_user, task_id)
    if current_user.role == "client":
        raise HTTPException(status_code=403, detail="Clients can view task media but cannot upload it")

    # Validate file type
    if file.content_type not in ALLOWED_MEDIA_TYPES:
        raise HTTPException(status_code=400, detail=f"File type not allowed. Use: {ALLOWED_MEDIA_TYPES}")

    # Create upload directory
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    storage_key, contents = _save_upload_file(file)
    media_type = "video" if file.content_type.startswith("video/") else "image"

    # Create DB record
    image = TaskImage(
        task_id=task_id,
        uploaded_by=current_user.id,
        image_url=f"/uploads/{storage_key}",
        storage_key=storage_key,
        file_size_bytes=len(contents),
    )
    db.add(image)

    # Log the upload
    log = TaskLog(
        task_id=task_id,
        user_id=current_user.id,
        action="media_uploaded",
        details=f"{media_type.title()} uploaded: {file.filename}, Size: {len(contents)} bytes",
    )
    db.add(log)
    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="task.media_uploaded",
        resource_type="task",
        resource_id=task.id,
        details={
            "media_type": media_type,
            "file_name": file.filename,
            "file_size_bytes": len(contents),
        },
    )

    db.commit()
    db.refresh(image)

    from app.api.v1.websocket import broadcast_notification

    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"{current_user.full_name} uploaded {media_type} evidence for '{task.title}'.",
        "info",
    )

    return _serialize_media(image)


def _list_task_media(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """List all uploaded task media."""
    _get_task_for_upload(db, current_user, task_id)

    images = db.query(TaskImage).filter(
        TaskImage.task_id == task_id
    ).order_by(TaskImage.uploaded_at.desc()).all()

    return [_serialize_media(img) for img in images]


@router.post("/tasks/{task_id}/media", status_code=status.HTTP_201_CREATED)
def upload_task_media(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    return _upload_task_media(task_id, background_tasks, file, db, current_user)


@router.get("/tasks/{task_id}/media")
def list_task_media(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    return _list_task_media(task_id, db, current_user)


@router.post("/tasks/{task_id}/images", status_code=status.HTTP_201_CREATED)
def upload_task_image(
    task_id: UUID,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    return _upload_task_media(task_id, background_tasks, file, db, current_user)


@router.get("/tasks/{task_id}/images")
def list_task_images(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    return _list_task_media(task_id, db, current_user)
