"""
MechTrack Pulse — Image Upload API Routes

Endpoints:
  POST /api/v1/uploads/tasks/{task_id}/images  → Upload image for a task
  GET  /api/v1/uploads/tasks/{task_id}/images  → List images for a task

Storage: Local filesystem (production would use S3/GCS)
"""

import os
import uuid as uuid_mod
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.core.dependencies import require_password_changed
from app.db.database import get_db
from app.models.task import Task
from app.models.task_image import TaskImage
from app.models.task_log import TaskLog
from app.models.user import User

router = APIRouter()

# Local upload directory
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "uploads")


@router.post("/tasks/{task_id}/images", status_code=status.HTTP_201_CREATED)
def upload_task_image(
    task_id: UUID,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """
    Upload an image for a task.
    Stored locally; returns the image metadata.
    """
    # Validate task exists and belongs to company
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Operators can only upload to their own tasks
    if current_user.role == "operator" and task.assigned_to != current_user.id:
        raise HTTPException(status_code=403, detail="You can only upload to your own tasks")

    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/webp", "image/gif"]
    if file.content_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"File type not allowed. Use: {allowed_types}")

    # Create upload directory
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    # Generate unique filename
    ext = file.filename.split(".")[-1] if file.filename else "jpg"
    storage_key = f"{uuid_mod.uuid4()}.{ext}"
    file_path = os.path.join(UPLOAD_DIR, storage_key)

    # Save file
    contents = file.file.read()
    with open(file_path, "wb") as f:
        f.write(contents)

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
        action="image_uploaded",
        details=f"File: {file.filename}, Size: {len(contents)} bytes",
    )
    db.add(log)

    db.commit()
    db.refresh(image)

    return {
        "id": str(image.id),
        "task_id": str(image.task_id),
        "image_url": image.image_url,
        "file_size_bytes": image.file_size_bytes,
        "uploaded_at": str(image.uploaded_at),
    }


@router.get("/tasks/{task_id}/images")
def list_task_images(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """List all images for a task."""
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    images = db.query(TaskImage).filter(
        TaskImage.task_id == task_id
    ).order_by(TaskImage.uploaded_at.desc()).all()

    return [
        {
            "id": str(img.id),
            "task_id": str(img.task_id),
            "image_url": img.image_url,
            "file_size_bytes": img.file_size_bytes,
            "uploaded_by": str(img.uploaded_by),
            "uploaded_at": str(img.uploaded_at),
        }
        for img in images
    ]
