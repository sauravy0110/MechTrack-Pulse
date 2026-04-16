"""
MechTrack Pulse — Job Version Snapshot Model

Stores immutable snapshots when specs or process plans are locked, and before
rework reopens a flow. This preserves history while allowing future changes.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class JobVersion(Base):
    __tablename__ = "job_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    task_id = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    version_number = Column(Integer, nullable=False, default=1)
    version_type = Column(String(40), nullable=False, doc="spec_lock | process_lock | rework_reset")
    snapshot = Column(JSON, nullable=False, default=dict)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self):
        return f"<JobVersion task={self.task_id} v{self.version_number} type={self.version_type}>"
