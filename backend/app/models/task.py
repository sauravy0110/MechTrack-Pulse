"""
MechTrack Pulse — Task Model

Company-scoped task with lifecycle tracking.
Status: idle → queued → in_progress → paused → completed → delayed → rework
Priority: low, medium, high, critical
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Tenant Isolation ─────────────────────────────────────
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # ── Task Details ─────────────────────────────────────────
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    status = Column(
        String(30),
        nullable=False,
        default="idle",
        doc=(
            "General: idle | queued | in_progress | paused | completed | delayed | "
            "CNC: created | planned | ready | assigned | setup | setup_done | "
            "first_piece_approval | qc_check | final_inspection | dispatched"
        ),
    )
    
    # ── Time Tracking & Issue Reporting ──────────────────────
    total_time_spent_seconds = Column(Integer, default=0, nullable=False)
    timer_started_at = Column(DateTime(timezone=True), nullable=True)
    delay_reason = Column(Text, nullable=True)

    priority = Column(
        String(10),
        nullable=False,
        default="medium",
        doc="low | medium | high | critical",
    )

    # ── Assignment ───────────────────────────────────────────
    assigned_to = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_by = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=False,
    )
    machine_id = Column(
        UUID(as_uuid=True),
        ForeignKey("machines.id", ondelete="SET NULL"),
        nullable=True,
    )
    client_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )

    # ── CNC Specific Fields ──────────────────────────────────
    is_locked = Column(Boolean, default=False, nullable=False)
    rework_flag = Column(Boolean, default=False, nullable=False)
    rework_iteration = Column(Integer, default=0, nullable=False)
    drawing_url = Column(String(512), nullable=True)
    material_type = Column(String(100), nullable=True)
    material_batch = Column(String(100), nullable=True)
    part_name = Column(String(255), nullable=True)
    rework_reason = Column(Text, nullable=True, doc="Reason for most recent rework trigger")

    # ── Timeline ─────────────────────────────────────────────
    estimated_completion = Column(DateTime(timezone=True), nullable=True)
    actual_completion = Column(DateTime(timezone=True), nullable=True)

    # ── AI ───────────────────────────────────────────────────
    delay_probability = Column(Float, nullable=True)

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
    assignee = relationship("User", foreign_keys=[assigned_to])
    creator = relationship("User", foreign_keys=[created_by])
    machine = relationship("Machine", back_populates="tasks")
    logs = relationship("TaskLog", back_populates="task", lazy="dynamic")
    images = relationship("TaskImage", back_populates="task", lazy="dynamic")
    job_specs = relationship("JobSpec", back_populates="task", lazy="dynamic", cascade="all, delete-orphan")
    job_processes = relationship("JobProcess", back_populates="task", order_by="JobProcess.sequence_order", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Task {self.title} [{self.status}] company={self.company_id}>"
