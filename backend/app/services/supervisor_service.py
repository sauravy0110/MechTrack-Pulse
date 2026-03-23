"""
MechTrack Pulse — Supervisor Service

Business logic for shifts and alert configurations.
"""

from uuid import UUID
from sqlalchemy.orm import Session
from app.models.shift import Shift
from app.models.alert_config import AlertConfig
from app.schemas.supervisor import ShiftCreate, AlertConfigCreate

# ── Shifts ───────────────────────────────────────────────────

def create_shift(db: Session, company_id: UUID, schema: ShiftCreate) -> Shift:
    shift = Shift(
        company_id=company_id,
        name=schema.name,
        start_time=schema.start_time,
        end_time=schema.end_time
    )
    db.add(shift)
    db.commit()
    db.refresh(shift)
    return shift

def get_shifts(db: Session, company_id: UUID) -> list[Shift]:
    return db.query(Shift).filter(Shift.company_id == company_id).all()


# ── Alert Config ─────────────────────────────────────────────

def upsert_alert_config(db: Session, company_id: UUID, schema: AlertConfigCreate) -> AlertConfig:
    config = db.query(AlertConfig).filter(
        AlertConfig.company_id == company_id,
        AlertConfig.alert_type == schema.alert_type
    ).first()

    if config:
        config.threshold_value = schema.threshold_value
        config.is_active = schema.is_active
        config.message_template = schema.message_template
    else:
        config = AlertConfig(
            company_id=company_id,
            alert_type=schema.alert_type,
            threshold_value=schema.threshold_value,
            is_active=schema.is_active,
            message_template=schema.message_template
        )
        db.add(config)
        
    db.commit()
    db.refresh(config)
    return config

def get_alert_configs(db: Session, company_id: UUID) -> list[AlertConfig]:
    return db.query(AlertConfig).filter(AlertConfig.company_id == company_id).all()
