"""
MechTrack Pulse — Audit Service

Helpers for recording and serializing audit logs from business actions.
"""

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog
from app.models.user import User


def record_audit_log(
    db: Session,
    *,
    company_id: UUID | None,
    actor: User | None,
    action: str,
    resource_type: str | None = None,
    resource_id: UUID | None = None,
    details: dict | None = None,
) -> AuditLog:
    entry = AuditLog(
        company_id=company_id,
        user_id=actor.id if actor else None,
        user_role=actor.role if actor else None,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        details=details or None,
    )
    db.add(entry)
    return entry


def list_company_audit_logs(
    db: Session,
    company_id: UUID,
    *,
    limit: int = 50,
) -> list[AuditLog]:
    return db.query(AuditLog).filter(
        AuditLog.company_id == company_id
    ).order_by(AuditLog.created_at.desc()).limit(limit).all()


def serialize_audit_log(entry: AuditLog) -> dict:
    return {
        "id": str(entry.id),
        "company_id": str(entry.company_id) if entry.company_id else None,
        "user_id": str(entry.user_id) if entry.user_id else None,
        "user_role": entry.user_role,
        "action": entry.action,
        "resource_type": entry.resource_type,
        "resource_id": str(entry.resource_id) if entry.resource_id else None,
        "details": entry.details or {},
        "created_at": str(entry.created_at),
    }
