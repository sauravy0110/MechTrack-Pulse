"""
MechTrack Pulse — JobSpec Model

Stores AI-extracted and human-verified drawing specifications for a CNC job.
Each row is one field (e.g. Length, Diameter, Thread) with both AI value and
the human-confirmed value. A job is "verified" when every spec is confirmed.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class JobSpec(Base):
    __tablename__ = "job_specs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Tenant Isolation ─────────────────────────────────────
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

    # ── Specification Fields ──────────────────────────────────
    field_name = Column(
        String(100),
        nullable=False,
        doc="e.g. Length, Diameter_1, Thread, Keyway, Groove, Tolerance",
    )
    ai_value = Column(
        String(200),
        nullable=True,
        doc="Value extracted by AI from drawing",
    )
    ai_confidence = Column(
        Float,
        nullable=True,
        doc="AI confidence score 0.0-1.0",
    )
    human_value = Column(
        String(200),
        nullable=True,
        doc="Supervisor-confirmed/edited value",
    )
    unit = Column(String(20), nullable=True, doc="e.g. mm, inches, M (for thread)")
    is_confirmed = Column(
        Boolean,
        nullable=False,
        default=False,
        doc="True when supervisor has reviewed and confirmed this spec",
    )

    # ── Timestamps ───────────────────────────────────────────
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # ── Relationships ────────────────────────────────────────
    task = relationship("Task", back_populates="job_specs")

    @property
    def confirmed_value(self) -> str | None:
        """Returns human_value if confirmed, else ai_value."""
        if self.is_confirmed and self.human_value:
            return self.human_value
        return self.ai_value

    def __repr__(self):
        return f"<JobSpec {self.field_name}={self.confirmed_value} task={self.task_id}>"
