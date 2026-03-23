"""
MechTrack Pulse — Operator Score Model

Tracks daily operator performance metrics.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, Date, DateTime, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class OperatorScore(Base):
    __tablename__ = "operator_scores"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    efficiency_score = Column(Float, nullable=False, default=0.0)
    delay_rate = Column(Float, nullable=False, default=0.0)
    tasks_completed = Column(Integer, nullable=False, default=0)
    tasks_delayed = Column(Integer, nullable=False, default=0)
    avg_completion_time = Column(Float, nullable=True, doc="In hours")
    score_date = Column(Date, nullable=False)

    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "score_date", name="uq_operator_score_date"),
    )

    user = relationship("User")

    def __repr__(self):
        return f"<OperatorScore user={self.user_id} date={self.score_date}>"
