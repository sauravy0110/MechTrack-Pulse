"""
MechTrack Pulse — Auth Service

WHY a service layer:
Routes should be thin — they handle HTTP concerns (request/response).
Business logic lives here. This makes it testable and reusable.

This service handles:
1. User login with lockout protection
2. Platform admin login
3. Password change (with must_change_password flow)
4. Company registration (public)
5. Company approval (platform admin)
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    validate_password_strength,
    verify_password,
)
from app.models.company import Company
from app.models.platform_admin import PlatformAdmin
from app.models.subscription import Subscription
from app.models.user import User

settings = get_settings()


# ═══════════════════════════════════════════════════════════════
# USER LOGIN
# ═══════════════════════════════════════════════════════════════

def authenticate_user(
    db: Session, email: str, password: str
) -> tuple[User | None, str]:
    """
    Authenticate a company user.

    Returns (user, error_message).
    - Success: (user_object, "")
    - Failure: (None, "reason")

    FLOW:
    1. Find user by email (could be in ANY company)
    2. Check if account is locked
    3. Verify password
    4. On failure: increment attempts, maybe lock
    5. On success: reset attempts, update last_login
    """
    # Find user — email alone is NOT unique (multi-tenant),
    # but for login we check all users with that email.
    # If multiple companies have same email, we try all.
    users = db.query(User).filter(
        User.email == email,
        User.is_active == True,
    ).all()

    if not users:
        return None, "Invalid email or password"

    # Try each user (rare to have duplicates across companies)
    for user in users:
        # ── Check lockout ────────────────────────────────
        if user.is_locked():
            remaining = (user.locked_until - datetime.now(timezone.utc)).seconds // 60
            return None, f"Account locked. Try again in {remaining + 1} minutes"

        # ── Check company status ─────────────────────────
        company = db.query(Company).filter(Company.id == user.company_id).first()
        if company and company.status != "active":
            return None, f"Company account is {company.status}"

        # ── Verify password ──────────────────────────────
        if verify_password(password, user.hashed_password):
            # Success → reset lockout counters
            user.failed_login_attempts = 0
            user.locked_until = None
            user.last_login_at = datetime.now(timezone.utc)
            db.commit()
            return user, ""

        # ── Wrong password → increment attempts ──────────
        user.failed_login_attempts += 1
        if user.failed_login_attempts >= settings.MAX_LOGIN_ATTEMPTS:
            user.locked_until = datetime.now(timezone.utc) + timedelta(
                minutes=settings.LOCKOUT_DURATION_MINUTES
            )
        db.commit()

    return None, "Invalid email or password"


def create_user_tokens(user: User) -> dict:
    """
    Generate access + refresh JWT tokens for a user.
    Payload includes company_id and role for downstream RBAC.
    """
    token_data = {
        "sub": str(user.id),
        "company_id": str(user.company_id),
        "role": user.role,
    }
    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "token_type": "bearer",
        "must_change_password": user.must_change_password,
    }


# ═══════════════════════════════════════════════════════════════
# PLATFORM ADMIN LOGIN
# ═══════════════════════════════════════════════════════════════

def authenticate_platform_admin(
    db: Session, email: str, password: str
) -> tuple[PlatformAdmin | None, str]:
    """Authenticate a platform admin (separate from company users)."""
    admin = db.query(PlatformAdmin).filter(
        PlatformAdmin.email == email,
        PlatformAdmin.is_active == True,
    ).first()

    if not admin:
        return None, "Invalid credentials"

    if not verify_password(password, admin.hashed_password):
        return None, "Invalid credentials"

    return admin, ""


def create_admin_tokens(admin: PlatformAdmin) -> dict:
    """Generate tokens for platform admin. Role = 'platform_admin'."""
    token_data = {
        "sub": str(admin.id),
        "company_id": "platform",
        "role": "platform_admin",
    }
    return {
        "access_token": create_access_token(token_data),
        "refresh_token": create_refresh_token(token_data),
        "token_type": "bearer",
        "must_change_password": False,
    }


# ═══════════════════════════════════════════════════════════════
# PASSWORD CHANGE
# ═══════════════════════════════════════════════════════════════

def change_user_password(
    db: Session, user: User, current_password: str, new_password: str
) -> tuple[bool, str]:
    """
    Change user password with validation.

    FLOW:
    1. Verify current password
    2. Validate new password strength
    3. Hash and save
    4. Clear must_change_password flag
    """
    if not verify_password(current_password, user.hashed_password):
        return False, "Current password is incorrect"

    is_valid, error = validate_password_strength(new_password)
    if not is_valid:
        return False, error

    user.hashed_password = hash_password(new_password)
    user.must_change_password = False
    db.commit()
    return True, "Password changed successfully"


# ═══════════════════════════════════════════════════════════════
# COMPANY REGISTRATION
# ═══════════════════════════════════════════════════════════════

def register_company(
    db: Session,
    company_name: str,
    gst_number: str | None,
    msme_number: str | None,
    industry_type: str | None,
    address: str | None,
    city: str | None,
    state: str | None,
    owner_name: str,
    owner_email: str,
    owner_phone: str | None,
) -> tuple[Company | None, str]:
    """
    Register a new company.

    FLOW:
    1. Check GST uniqueness
    2. Create company (status = 'pending')
    3. Create subscription (free plan)
    4. Store owner details for later (owner user created on approval)

    NOTE: Owner user is NOT created yet. Only after Platform Admin
    approves the company, the Owner account is generated.
    """
    # Check GST uniqueness
    if gst_number:
        existing = db.query(Company).filter(Company.gst_number == gst_number).first()
        if existing:
            return None, "A company with this GST number already exists"

    # Check if owner email is already registered (pending or active)
    existing_registration = db.query(Company).filter(Company.owner_email == owner_email).first()
    if existing_registration:
        return None, "Email already registered"

    # Also check if it's already a user
    existing_user = db.query(User).filter(User.email == owner_email).first()
    if existing_user:
        return None, "Email already registered"

    # Create company
    company = Company(
        name=company_name,
        gst_number=gst_number,
        msme_number=msme_number,
        industry_type=industry_type,
        address=address,
        city=city,
        state=state,
        owner_email=owner_email,
        status="pending",
    )
    db.add(company)
    db.flush()

    # Create free subscription
    subscription = Subscription(
        company_id=company.id,
        plan="free",
        max_users=5,
        max_machines=3,
        max_tasks_per_month=50,
        ai_enabled=False,
    )
    db.add(subscription)

    db.commit()
    db.refresh(company)

    # Store owner details in a way we can use during approval
    # For now, we store them as part of the audit trail
    # The actual owner User is created during approve_company()

    return company, ""


# ═══════════════════════════════════════════════════════════════
# COMPANY APPROVAL (Platform Admin)
# ═══════════════════════════════════════════════════════════════

def approve_company(
    db: Session,
    company_id: UUID,
    owner_name: str,
    owner_email: str,
    owner_phone: str | None = None,
) -> tuple[User | None, str, str]:
    """
    Approve a pending company and create the Owner user.

    Returns (owner_user, temp_password, error).
    """
    from app.core.security import generate_temp_password

    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        return None, "", "Company not found"

    if company.status != "pending":
        return None, "", f"Company is already {company.status}"

    # Generate temp password for owner
    temp_password = generate_temp_password()

    company.owner_email = owner_email

    # Create owner user
    owner = User(
        company_id=company.id,
        email=owner_email,
        phone=owner_phone,
        hashed_password=hash_password(temp_password),
        full_name=owner_name,
        role="owner",
        must_change_password=True,
    )
    db.add(owner)

    # Update subscription usage
    subscription = db.query(Subscription).filter(
        Subscription.company_id == company.id
    ).first()
    if subscription:
        subscription.current_usage_users = 1

    # Activate company
    company.status = "active"
    db.commit()

    return owner, temp_password, ""


def seed_platform_admin(db: Session) -> None:
    """
    Create the initial platform admin if none exists.
    Called once on first startup.
    """
    existing = db.query(PlatformAdmin).first()
    if existing:
        return

    admin = PlatformAdmin(
        email=settings.PLATFORM_ADMIN_EMAIL,
        hashed_password=hash_password(settings.PLATFORM_ADMIN_PASSWORD),
        full_name="Platform Admin",
    )
    db.add(admin)
    db.commit()
    print(f"🔑 Platform admin seeded: {settings.PLATFORM_ADMIN_EMAIL}")
