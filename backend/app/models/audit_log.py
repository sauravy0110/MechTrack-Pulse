"""
MechTrack Pulse — Audit Log Model

WHY this table exists:
Production systems MUST track who did what. Without audit logs,
you can't debug issues, prove compliance, or detect abuse.

DESIGN DECISIONS:
- JSONB for details: flexible metadata without schema migration
- company_id nullable: platform-level actions have no company
- No FK on user_id: audit logs survive user deletion
- Indexed on (company_id, created_at DESC): fast per-tenant queries
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, Index, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.db.database import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Nullable — platform-level actions have no company
    company_id = Column(UUID(as_uuid=True), nullable=True, index=True)

    # Actor — not an FK so logs survive user deletion
    user_id = Column(UUID(as_uuid=True), nullable=True)
    user_role = Column(String(20), nullable=True)

    # What happened
    action = Column(
        String(50),
        nullable=False,
        doc="e.g. user.created, task.assigned, company.approved",
    )
    resource_type = Column(
        String(30),
        nullable=True,
        doc="e.g. task, user, machine, company",
    )
    resource_id = Column(UUID(as_uuid=True), nullable=True)

    # Flexible metadata — different actions store different details
    details = Column(JSONB, nullable=True, doc="Action-specific metadata")

    ip_address = Column(String(45), nullable=True, doc="IPv4 or IPv6")

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # ── Index for fast per-tenant queries ────────────────────
    __table_args__ = (
        Index("idx_audit_company_date", "company_id", "created_at"),
    )

    def __repr__(self):
        return f"<AuditLog {self.action} by user={self.user_id}>"
