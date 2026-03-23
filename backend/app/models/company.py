"""
MechTrack Pulse — Company Model

WHY this table exists:
Every tenant in the system is a "company". This is the root entity
for multi-tenant isolation. All other company-scoped tables reference
companies.id via company_id FK.

WHY separate from users:
A company is registered BEFORE any users exist. Platform Owner
approves the company, THEN the Owner user is created inside it.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, Column, DateTime, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class Company(Base):
    __tablename__ = "companies"

    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        doc="Unique company identifier",
    )
    name = Column(String(255), nullable=False, doc="Company display name")
    gst_number = Column(
        String(15), unique=True, nullable=True, doc="GST identification number"
    )
    msme_number = Column(String(20), nullable=True, doc="MSME registration number")
    industry_type = Column(String(100), nullable=True, doc="e.g. Manufacturing, Auto")
    address = Column(Text, nullable=True)
    city = Column(String(100), nullable=True)
    state = Column(String(100), nullable=True)
    owner_email = Column(String(255), nullable=False, unique=True, doc="Main contact email")

    # Status controls whether the company can use the system
    # pending → Platform Owner must approve before company is active
    status = Column(
        String(20),
        nullable=False,
        default="pending",
        doc="pending | active | suspended | rejected",
    )

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
    # back_populates keeps both sides in sync
    users = relationship("User", back_populates="company", lazy="dynamic")
    subscription = relationship(
        "Subscription", back_populates="company", uselist=False  # one-to-one
    )

    def __repr__(self):
        return f"<Company {self.name} [{self.status}]>"
