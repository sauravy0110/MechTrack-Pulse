"""
MechTrack Pulse — Task Log Model

Tracks every state change on a task for audit trail.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class TaskLog(Base):
    __tablename__ = "task_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=False,
    )

    action = Column(
        String(30),
        nullable=False,
        doc="created | started | completed | delayed | reassigned | image_uploaded | updated",
    )
    previous_value = Column(String(50), nullable=True)
    new_value = Column(String(50), nullable=True)
    details = Column(Text, nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # ── Relationships ────────────────────────────────────────
    task = relationship("Task", back_populates="logs")
    user = relationship("User")

    def __repr__(self):
        return f"<TaskLog {self.action} on task={self.task_id}>"
