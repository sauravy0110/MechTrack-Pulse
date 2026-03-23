"""
MechTrack Pulse — Subscription Model

WHY this table exists:
Controls what each company CAN do. Without this, every company
gets unlimited access — which breaks the SaaS business model.

WHY separate from companies:
- Single Responsibility: company = identity, subscription = billing/limits
- Can swap/upgrade plans without touching company data
- Clean queries: "is this company allowed to use AI?" → check subscription

PLAN LIMITS:
  free:         5 users,   3 machines,    50 tasks/month, no AI
  starter:     20 users,  15 machines,   500 tasks/month, AI enabled
  professional:100 users, 50 machines, 5000 tasks/month, AI enabled
  enterprise:  unlimited (represented as -1 in code)
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # One-to-one with companies (UNIQUE constraint enforces this)
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    plan = Column(
        String(20),
        nullable=False,
        default="free",
        doc="free | starter | professional | enterprise",
    )

    # ── Plan Limits ──────────────────────────────────────────
    # -1 means unlimited (enterprise)
    max_users = Column(Integer, nullable=False, default=5)
    max_machines = Column(Integer, nullable=False, default=3)
    max_tasks_per_month = Column(Integer, nullable=False, default=50)
    ai_enabled = Column(Boolean, nullable=False, default=False)

    # ── Usage Tracking ───────────────────────────────────────
    # WHY here: Avoid counting users/tasks every API call.
    # Increment on create, decrement on delete. Fast O(1) check.
    current_usage_users = Column(Integer, nullable=False, default=0)
    current_usage_tasks = Column(Integer, nullable=False, default=0)

    # ── Billing ──────────────────────────────────────────────
    started_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )
    expires_at = Column(DateTime(timezone=True), nullable=True, doc="NULL = no expiry")
    payment_status = Column(
        String(20),
        nullable=False,
        default="pending",
        doc="pending | paid | overdue | exempt",
    )

    updated_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # ── Relationships ────────────────────────────────────────
    company = relationship("Company", back_populates="subscription")

    def can_add_user(self) -> bool:
        """Check if company hasn't exceeded user limit. -1 = unlimited."""
        if self.max_users == -1:
            return True
        return self.current_usage_users < self.max_users

    def can_add_task(self) -> bool:
        """Check if company hasn't exceeded monthly task limit."""
        if self.max_tasks_per_month == -1:
            return True
        return self.current_usage_tasks < self.max_tasks_per_month

    def __repr__(self):
        return f"<Subscription {self.plan} for company={self.company_id}>"
