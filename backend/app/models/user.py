"""
MechTrack Pulse — User Model

WHY this table exists:
Every person in the system is a user scoped to ONE company.
The company_id FK ensures tenant isolation — a user can NEVER
see data from another company.

ROLES (inside a company):
  owner      → Company Owner. Creates all other users. Full control.
  supervisor → Shop floor manager. Creates tasks, assigns operators.
  operator   → Executes tasks. Views own tasks only.
  client     → Read-only viewer. Sees reports + 3D dashboard.

SECURITY FIELDS:
  must_change_password  → true on first login (temp password flow)
  failed_login_attempts → incremented on bad login, reset on success
  locked_until          → if set and in future, account is locked
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # ── Tenant Isolation ─────────────────────────────────────
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
        doc="Every query MUST filter by this",
    )

    # ── Identity ─────────────────────────────────────────────
    email = Column(String(255), nullable=False)
    phone = Column(String(15), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)

    # ── Role ─────────────────────────────────────────────────
    role = Column(
        String(20),
        nullable=False,
        doc="owner | supervisor | operator | client",
    )
    department = Column(String(100), nullable=True)

    # ── Operator Duty ────────────────────────────────────────
    is_on_duty = Column(
        Boolean, nullable=False, default=False,
        doc="True = operator is available for task assignment",
    )
    current_task_count = Column(
        Integer, nullable=False, default=0,
        doc="Number of tasks currently assigned (max 5)",
    )
    last_active_at = Column(
        DateTime(timezone=True), nullable=True,
        doc="Last time operator toggled duty or completed a task",
    )

    # ── Account Status ───────────────────────────────────────
    is_active = Column(Boolean, nullable=False, default=True)
    must_change_password = Column(
        Boolean,
        nullable=False,
        default=True,
        doc="True = user must change password on next login",
    )

    # ── Security: Lockout ────────────────────────────────────
    failed_login_attempts = Column(Integer, nullable=False, default=0)
    locked_until = Column(
        DateTime(timezone=True),
        nullable=True,
        doc="NULL = not locked. If set and > now(), account is locked",
    )

    # ── Timestamps ───────────────────────────────────────────
    last_login_at = Column(DateTime(timezone=True), nullable=True)
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

    # ── Unique constraint: email unique PER company ──────────
    # Two companies CAN have users with the same email
    __table_args__ = (
        UniqueConstraint("company_id", "email", name="uq_user_company_email"),
    )

    # ── Relationships ────────────────────────────────────────
    company = relationship("Company", back_populates="users")

    def is_locked(self) -> bool:
        """Check if account is currently locked."""
        if self.locked_until is None:
            return False
        return datetime.now(timezone.utc) < self.locked_until

    def __repr__(self):
        return f"<User {self.email} role={self.role} company={self.company_id}>"
