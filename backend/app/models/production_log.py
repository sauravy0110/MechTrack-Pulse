"""
MechTrack Pulse — Production Log Model

Stores operator-entered production, rejection, and downtime information during
live manufacturing.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, Text
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class ProductionLog(Base):
    __tablename__ = "production_logs"

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
    logged_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    produced_qty = Column(Integer, nullable=False, default=0)
    rejected_qty = Column(Integer, nullable=False, default=0)
    downtime_minutes = Column(Integer, nullable=False, default=0)
    notes = Column(Text, nullable=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self):
        return f"<ProductionLog task={self.task_id} produced={self.produced_qty}>"
