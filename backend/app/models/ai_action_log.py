"""
MechTrack Pulse — AI Action Logs Model

WHY: When the AI takes autonomous action (e.g. reassigning a task to mitigate load),
it MUST be logged for accountability and auditing.
"""

from datetime import datetime, timezone
import uuid

from sqlalchemy import Column, String, DateTime, ForeignKey, JSON
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.db.database import Base

class AIActionLog(Base):
    """Audit trail for decisions made autonomously by the system."""
    __tablename__ = "ai_action_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    company_id = Column(
        UUID(as_uuid=True), ForeignKey("companies.id", ondelete="CASCADE"), nullable=False
    )
    
    action_type = Column(String(50), nullable=False)  # e.g., "TASK_REASSIGNMENT", "PREVENTATIVE"
    reason = Column(String(255), nullable=False)      # e.g., "Queue exceeded 3. Reassigned to Op B."
    
    # Store dynamic data related to the action
    metadata_payload = Column(JSON, nullable=True)
    
    created_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False
    )

    company = relationship("Company")
