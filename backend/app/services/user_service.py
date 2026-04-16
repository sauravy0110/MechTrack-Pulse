"""
MechTrack Pulse — User Service

Business logic for user management.
Handles creation (with subscription limit checks), listing, updates, deactivation.

KEY PRINCIPLE: company_id ALWAYS comes from JWT token, never from request body.
"""

import logging
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.security import generate_temp_password, hash_password
from app.models.subscription import Subscription
from app.models.user import User

logger = logging.getLogger("app.user_service")


def create_user(
    db: Session,
    company_id: UUID,
    email: str,
    full_name: str,
    role: str,
    phone: str | None = None,
    department: str | None = None,
    send_welcome_email: bool = True,
) -> tuple[User | None, str, str]:
    """
    Create a new user within a company.

    Returns (user, temp_password, error).

    CHECKS:
    1. Subscription user limit
    2. Duplicate email within company
    3. Role validation (owner can't be created here)
    """
    # ── Check subscription limit ─────────────────────────
    subscription = db.query(Subscription).filter(
        Subscription.company_id == company_id
    ).first()

    if subscription and not subscription.can_add_user():
        return None, "", f"User limit reached ({subscription.max_users}). Upgrade your plan."

    # ── Check duplicate email in same company ────────────
    existing = db.query(User).filter(
        User.company_id == company_id,
        User.email == email,
    ).first()
    if existing:
        return None, "", "A user with this email already exists in your company"

    # ── Prevent owner creation via this endpoint ─────────
    if role == "owner":
        return None, "", "Cannot create owner through user management"

    # ── Generate temp password ───────────────────────────
    temp_password = generate_temp_password()

    user = User(
        company_id=company_id,
        email=email,
        phone=phone,
        hashed_password=hash_password(temp_password),
        full_name=full_name,
        role=role,
        department=department,
        must_change_password=True,
    )
    db.add(user)

    # ── Update subscription usage counter ────────────────
    if subscription:
        subscription.current_usage_users += 1

    db.commit()
    db.refresh(user)

    # ── Send onboarding email ────────────────────────────
    from app.models.company import Company
    from app.services.email_service import send_user_welcome_email
    
    company = db.query(Company).filter(Company.id == company_id).first()
    company_name = company.name if company else "Your Company"
    
    if send_welcome_email:
        email_sent, email_error = send_user_welcome_email(
            user_name=full_name,
            user_email=email,
            company_name=company_name,
            role=role,
            temp_password=temp_password
        )
        if not email_sent:
            logger.warning("User welcome email was not delivered to %s: %s", email, email_error)

    return user, temp_password, ""


def list_users(
    db: Session,
    company_id: UUID,
    role_filter: str | None = None,
    active_only: bool = True,
) -> list[User]:
    """List all users in a company, optionally filtered by role."""
    query = db.query(User).filter(User.company_id == company_id)

    if role_filter:
        query = query.filter(User.role == role_filter)
    if active_only:
        query = query.filter(User.is_active == True)

    return query.order_by(User.created_at.desc()).all()


def get_user(db: Session, company_id: UUID, user_id: UUID) -> User | None:
    """Get a single user by ID, scoped to company."""
    return db.query(User).filter(
        User.id == user_id,
        User.company_id == company_id,
    ).first()


def update_user(
    db: Session,
    company_id: UUID,
    user_id: UUID,
    updates: dict,
) -> tuple[User | None, str]:
    """
    Update user fields. Only non-None fields are applied.
    Returns (user, error).
    """
    user = get_user(db, company_id, user_id)
    if not user:
        return None, "User not found"

    # Prevent changing owner role
    if user.role == "owner" and "role" in updates and updates["role"] != "owner":
        return None, "Cannot change the owner's role"

    for field, value in updates.items():
        if value is not None and hasattr(user, field):
            setattr(user, field, value)

    db.commit()
    db.refresh(user)
    return user, ""


def deactivate_user(
    db: Session,
    company_id: UUID,
    user_id: UUID,
) -> tuple[bool, str]:
    """Deactivate a user (soft delete). Decrements subscription usage."""
    user = get_user(db, company_id, user_id)
    if not user:
        return False, "User not found"

    if user.role == "owner":
        return False, "Cannot deactivate the company owner"

    if not user.is_active:
        return False, "User is already deactivated"

    user.is_active = False

    # Decrement subscription usage
    subscription = db.query(Subscription).filter(
        Subscription.company_id == company_id
    ).first()
    if subscription and subscription.current_usage_users > 0:
        subscription.current_usage_users -= 1

    db.commit()
    return True, "User deactivated successfully"
