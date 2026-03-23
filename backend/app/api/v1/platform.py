"""
MechTrack Pulse — Platform Admin API Routes

These endpoints are for the Platform Owner (you).
Separate from company users — different login, different power.

Endpoints:
  POST  /api/v1/platform/login                    → Admin login
  GET   /api/v1/platform/companies                 → List all companies
  PATCH /api/v1/platform/companies/{id}/approve    → Approve + create owner
  PATCH /api/v1/platform/companies/{id}/reject     → Reject company
  PATCH /api/v1/platform/companies/{id}/suspend    → Suspend company
  GET   /api/v1/platform/stats                     → Platform metrics
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.db.database import get_db
from app.models.company import Company
from app.models.platform_admin import PlatformAdmin
from app.models.user import User
from app.schemas.company import CompanyResponse
from app.services.auth_service import (
    authenticate_platform_admin,
    approve_company,
    create_admin_tokens,
)
from app.services.email_service import send_owner_welcome_email

router = APIRouter()


# ── Schemas (platform-specific) ──────────────────────────────

class PlatformLoginRequest(BaseModel):
    """Request body for platform admin login. NOT query params (security)."""
    email: EmailStr
    password: str = Field(..., min_length=1)

class SubscriptionUpgradeRequest(BaseModel):
    """Admin or Billing override for subscription plans."""
    plan: str = Field(..., pattern="^(free|starter|professional|enterprise)$")

class BillingWebhookPayload(BaseModel):
    """Simulated Stripe/Braintree webhook payload."""
    company_id: UUID
    plan: str
    status: str
    transaction_id: str


class ApproveCompanyRequest(BaseModel):
    """Request body for approve — owner details needed to create user."""
    owner_name: str = Field(..., min_length=2, max_length=100)
    owner_email: EmailStr
    owner_phone: str | None = Field(None, max_length=15)


# ── Helper: verify platform admin from token ─────────────────

platform_oauth2 = OAuth2PasswordBearer(tokenUrl="/api/v1/platform/login")


def get_platform_admin(
    token: str = Depends(platform_oauth2),
    db: Session = Depends(get_db),
) -> PlatformAdmin:
    """Verify that the caller is a platform admin."""
    payload = decode_token(token)
    if payload is None or payload.get("role") != "platform_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform admin access required",
        )

    admin = db.query(PlatformAdmin).filter(
        PlatformAdmin.id == payload.get("sub")
    ).first()
    if not admin or not admin.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Admin not found or inactive",
        )
    return admin


# ── Platform Admin Login ─────────────────────────────────────

@router.post("/login")
def platform_login(
    request: PlatformLoginRequest,
    db: Session = Depends(get_db),
):
    """
    Login as platform admin.
    WHY request body not query params: passwords in URLs get logged
    in server access logs, browser history, and proxy caches.
    """
    admin, error = authenticate_platform_admin(db, request.email, request.password)
    if not admin:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error,
        )
    return create_admin_tokens(admin)


# ── List All Companies ───────────────────────────────────────

@router.get("/companies", response_model=list[CompanyResponse])
def list_companies(
    status_filter: str | None = Query(None, alias="status"),
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(get_platform_admin),
):
    """
    List all registered companies.
    Optional filter by status: pending, active, suspended, rejected.
    """
    query = db.query(Company)
    if status_filter:
        query = query.filter(Company.status == status_filter)
    companies = query.order_by(Company.created_at.desc()).all()
    return companies


# ── Approve Company ──────────────────────────────────────────

@router.patch("/companies/{company_id}/approve")
def approve_company_route(
    company_id: UUID,
    request: ApproveCompanyRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(get_platform_admin),
):
    """
    Approve a pending company.
    Creates the Owner user with a temp password.
    Emails the temp password when SMTP is configured.
    If email delivery is unavailable, returns the temp password
    so the admin can share it manually.
    """
    owner, temp_password, error = approve_company(
        db, company_id, request.owner_name, request.owner_email, request.owner_phone
    )
    if error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error,
        )

    company = db.query(Company).filter(Company.id == company_id).first()
    company_name = company.name if company else "Your company"
    email_sent, email_error = send_owner_welcome_email(
        owner_name=request.owner_name,
        owner_email=request.owner_email,
        company_name=company_name,
        temp_password=temp_password,
    )

    response = {
        "message": "Company approved successfully",
        "owner_email": request.owner_email,
        "must_change_password": True,
        "email_sent": email_sent,
    }

    if email_sent:
        response["note"] = "Temporary password sent to the owner email."
    else:
        response["temp_password"] = temp_password
        response["note"] = "Email delivery failed or is not configured. Share the temporary password manually."
        response["email_error"] = email_error

    return response


# ── Reject Company ───────────────────────────────────────────

@router.patch("/companies/{company_id}/reject")
def reject_company(
    company_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(get_platform_admin),
):
    """Reject a pending company registration."""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    if company.status != "pending":
        raise HTTPException(
            status_code=400, detail=f"Company is already {company.status}"
        )

    company.status = "rejected"
    db.commit()
    return {"message": f"Company '{company.name}' rejected"}


# ── Suspend Company ──────────────────────────────────────────

@router.patch("/companies/{company_id}/suspend")
def suspend_company(
    company_id: UUID,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(get_platform_admin),
):
    """Suspend an active company. All users lose access."""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    company.status = "suspended"
    db.commit()
    return {"message": f"Company '{company.name}' suspended"}


# ── Subscriptions & Billing ──────────────────────────────────

from app.models.subscription import Subscription

@router.patch("/companies/{company_id}/subscription")
def update_subscription(
    company_id: UUID,
    request: SubscriptionUpgradeRequest,
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(get_platform_admin)
):
    """Force update a company's subscription plan directly (Admin)."""
    sub = db.query(Subscription).filter(Subscription.company_id == company_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")

    sub.plan = request.plan
    if request.plan == "free":
        sub.max_users, sub.max_machines, sub.max_tasks_per_month, sub.ai_enabled = 5, 3, 50, False
    elif request.plan == "starter":
        sub.max_users, sub.max_machines, sub.max_tasks_per_month, sub.ai_enabled = 20, 15, 500, True
    elif request.plan == "professional":
        sub.max_users, sub.max_machines, sub.max_tasks_per_month, sub.ai_enabled = 100, 50, 5000, True
    elif request.plan == "enterprise":
        sub.max_users = sub.max_machines = sub.max_tasks_per_month = -1
        sub.ai_enabled = True
        
    db.commit()
    return {"message": f"Subscription updated to {request.plan}"}


@router.post("/billing/webhook")
def billing_webhook_simulation(
    payload: BillingWebhookPayload,
    db: Session = Depends(get_db)
):
    """
    Simulated webhook receiver (e.g. from Stripe).
    Updates subscription automatically on successful payment.
    In real life this needs signature validation.
    """
    if payload.status != "succeeded":
        return {"status": "ignored"}
        
    sub = db.query(Subscription).filter(Subscription.company_id == payload.company_id).first()
    if not sub:
        raise HTTPException(status_code=404, detail="Company sub not found")
        
    sub.plan = payload.plan
    sub.payment_status = "paid"
    
    if payload.plan == "starter":
        sub.max_users, sub.max_machines, sub.max_tasks_per_month, sub.ai_enabled = 20, 15, 500, True
    elif payload.plan == "professional":
        sub.max_users, sub.max_machines, sub.max_tasks_per_month, sub.ai_enabled = 100, 50, 5000, True
    elif payload.plan == "enterprise":
        sub.max_users = sub.max_machines = sub.max_tasks_per_month = -1
        sub.ai_enabled = True
        
    db.commit()
    return {"status": "success", "message": "Plan upgraded automatically"}


# ── Platform Stats ───────────────────────────────────────────
from sqlalchemy import func

@router.get("/stats")
def platform_stats(
    db: Session = Depends(get_db),
    admin: PlatformAdmin = Depends(get_platform_admin),
):
    """Global platform statistics including subscriptions."""
    total_companies = db.query(Company).count()
    active = db.query(Company).filter(Company.status == "active").count()
    pending = db.query(Company).filter(Company.status == "pending").count()
    total_users = db.query(User).count()
    
    # Subscription counts
    sub_query = db.query(Subscription.plan, func.count(Subscription.id)).group_by(Subscription.plan).all()
    plans = {k: v for k, v in sub_query}

    return {
        "total_companies": total_companies,
        "active_companies": active,
        "pending_companies": pending,
        "total_users": total_users,
        "subscriptions": plans,
    }
