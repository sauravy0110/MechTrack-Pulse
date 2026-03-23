"""
MechTrack Pulse — Platform Admin Model

WHY separate from User:
Platform admins are NOT inside any company. They control the
platform itself — approving companies, managing subscriptions.
Keeping them in a separate table:
  1. No company_id needed
  2. Different auth flow (separate login endpoint)
  3. Cannot accidentally mix with company users
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class PlatformAdmin(Base):
    __tablename__ = "platform_admins"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(100), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def __repr__(self):
        return f"<PlatformAdmin {self.email}>"
