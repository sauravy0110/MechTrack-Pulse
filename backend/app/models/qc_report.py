"""
MechTrack Pulse — QC Report Model

Stores human-entered quality checkpoints for first-piece, in-process, and final
inspection stages.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import JSON, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class QCReport(Base):
    __tablename__ = "qc_reports"

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
    recorded_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    stage = Column(String(40), nullable=False, doc="first_piece | in_process | final")
    qc_status = Column(String(20), nullable=False, doc="pass | fail | rework")
    measured_values = Column(JSON, nullable=False, default=dict)
    remarks = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self):
        return f"<QCReport task={self.task_id} stage={self.stage} status={self.qc_status}>"
