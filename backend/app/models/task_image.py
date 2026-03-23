"""
MechTrack Pulse — Task Image Model

Stores uploaded images linked to tasks.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class TaskImage(Base):
    __tablename__ = "task_images"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    uploaded_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=False,
    )

    image_url = Column(String(500), nullable=False)
    storage_key = Column(String(500), nullable=False)
    file_size_bytes = Column(Integer, nullable=True)

    uploaded_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # ── Relationships ────────────────────────────────────
    task = relationship("Task", back_populates="images")
    uploader = relationship("User")

    def __repr__(self):
        return f"<TaskImage task={self.task_id} by={self.uploaded_by}>"
