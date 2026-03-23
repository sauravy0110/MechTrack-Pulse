"""
MechTrack Pulse — AI Insight Model

Stores AI-generated insights (delay risks, overload warnings, etc.).
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class AIInsight(Base):
    __tablename__ = "ai_insights"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    insight_type = Column(
        String(20),
        nullable=False,
        doc="delay_risk | overload | reassignment | efficiency | anomaly",
    )
    message = Column(Text, nullable=False)

    related_task = Column(
        UUID(as_uuid=True),
        ForeignKey("tasks.id", ondelete="SET NULL"),
        nullable=True,
    )
    related_user = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    severity = Column(
        String(10),
        nullable=False,
        default="info",
        doc="info | warning | critical",
    )
    is_read = Column(Boolean, nullable=False, default=False)

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    task = relationship("Task")
    user = relationship("User")

    def __repr__(self):
        return f"<AIInsight {self.insight_type} [{self.severity}]>"
