"""
MechTrack Pulse — Alert Configuration Model

Stores configurable thresholds for supervisor alerts.
"""
import uuid
from sqlalchemy import Column, String, Float, ForeignKey, Boolean
from sqlalchemy.dialects.postgresql import UUID

from app.db.database import Base


class AlertConfig(Base):
    __tablename__ = "alert_configs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    alert_type = Column(String(50), nullable=False, doc="machine_delay | operator_overload | idle_warning")
    threshold_value = Column(Float, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    message_template = Column(String(255), nullable=True)

    def __repr__(self):
        return f"<AlertConfig {self.alert_type} > {self.threshold_value}>"
