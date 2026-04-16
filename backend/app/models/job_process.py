"""
MechTrack Pulse — JobProcess Model

Stores the process plan (sequence of operations) for a CNC job.
Each row is one operation (e.g. Turning, Drilling, Grinding) with
its machine, tooling, cycle time, and sequence position.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class JobProcess(Base):
    __tablename__ = "job_processes"

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

    # ── Operation Details ────────────────────────────────────
    operation_name = Column(
        String(200),
        nullable=False,
        doc="e.g. Rough Turning, Thread Cutting, OD Grinding, Keyway Milling",
    )
    machine_id = Column(
        UUID(as_uuid=True),
        ForeignKey("machines.id", ondelete="SET NULL"),
        nullable=True,
    )
    tool_required = Column(String(200), nullable=True, doc="e.g. CNMG Insert T15, M20 Tap")
    cycle_time_minutes = Column(Integer, nullable=True, doc="Estimated cycle time in minutes")
    sequence_order = Column(
        Integer,
        nullable=False,
        default=1,
        doc="Execution order of this operation in the process plan",
    )
    notes = Column(Text, nullable=True)

    # ── AI Metadata ──────────────────────────────────────────
    is_ai_suggested = Column(
        Boolean,
        nullable=False,
        default=False,
        doc="True if this step was suggested by AI (not manually added)",
    )
    is_locked = Column(
        Boolean,
        nullable=False,
        default=False,
        doc="True when process plan is locked by supervisor",
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
    task = relationship("Task", back_populates="job_processes")
    machine = relationship("Machine")

    def __repr__(self):
        return f"<JobProcess {self.sequence_order}. {self.operation_name} task={self.task_id}>"
