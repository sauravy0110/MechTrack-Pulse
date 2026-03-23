"""
MechTrack Pulse — Machine Model

Company-scoped machines with grid coordinates for 3D visualization.
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base


class Machine(Base):
    __tablename__ = "machines"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    name = Column(String(100), nullable=False)
    machine_type = Column(String(50), nullable=True)

    # Grid coordinates for 3D shop floor visualization
    grid_x = Column(Integer, nullable=False, default=0)
    grid_y = Column(Integer, nullable=False, default=0)

    status = Column(
        String(20),
        nullable=False,
        default="idle",
        doc="idle | active | maintenance",
    )

    created_at = Column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    # ── Unique: machine name per company ─────────────────
    __table_args__ = (
        UniqueConstraint("company_id", "name", name="uq_machine_company_name"),
    )

    # ── Relationships ────────────────────────────────────
    tasks = relationship("Task", back_populates="machine", lazy="dynamic")

    def __repr__(self):
        return f"<Machine {self.name} [{self.status}] company={self.company_id}>"
