"""
MechTrack Pulse — Auth API Routes

Endpoints:
  POST /api/v1/auth/login           → User login → JWT tokens
  POST /api/v1/auth/refresh         → Refresh access token
  GET  /api/v1/auth/me              → Current user profile
  POST /api/v1/auth/change-password → Change password
"""

from datetime import datetime, timezone
import logging

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.v1.websocket import broadcast_operator_update
from app.core.dependencies import get_current_user
from app.core.rate_limit import limiter
from app.core.redis import redis_client
from app.db.database import get_db
from app.models.user import User
from app.schemas.auth import (
    ChangePasswordRequest,
    LoginRequest,
    RefreshRequest,
    TokenResponse,
    UserProfileResponse,
    ForgotPasswordRequest,
    ResetPasswordRequest,
)
from app.services.auth_service import (
    authenticate_user,
    change_user_password,
    create_user_tokens,
)
from app.services.email_service import send_password_reset_email
from app.services.operator_service import (
    activate_operator_for_login,
    build_operator_payload,
    get_operator_skill_snapshot,
    sync_operator_duty_state,
)
from app.core.security import (
    create_password_reset_token, 
    decode_token,
    verify_password_reset_token,
    validate_password_strength,
    hash_password
)

router = APIRouter()
logger = logging.getLogger("app.auth")


# ── Login ────────────────────────────────────────────────────

@router.post("/login", response_model=TokenResponse)
# Login is the only endpoint every new user hits in quick succession during
# onboarding. A stricter 5/minute per-IP limit caused legitimate same-network
# first-login flows to trip 429s, so this route uses a higher cap.
@limiter.limit("30/minute")
def login(
    request: Request,
    login_data: LoginRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Authenticate user and return JWT tokens.

    WHY return must_change_password:
    Frontend checks this flag. If true, it redirects to the
    change-password screen before allowing any other action.
    """
    user, error = authenticate_user(db, login_data.email, login_data.password)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error,
        )

    user, duty_changed = activate_operator_for_login(db, user)
    if duty_changed:
        background_tasks.add_task(
            broadcast_operator_update,
            user.company_id,
            build_operator_payload(db, user.company_id, user),
        )

    tokens = create_user_tokens(user)
    return tokens


# ── Refresh Token ────────────────────────────────────────────

@router.post("/refresh", response_model=TokenResponse)
@limiter.limit("10/minute")
def refresh_token(request: Request, refresh_data: RefreshRequest, db: Session = Depends(get_db)):
    """
    Exchange a valid refresh token for a new access token.

    WHY needed:
    Access tokens expire in 30 min. Instead of re-entering
    credentials, the client sends the refresh token (7-day expiry)
    to get a fresh access token silently.
    """
    payload = decode_token(refresh_data.refresh_token)
    if payload is None or payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired refresh token",
        )

    jti = payload.get("jti")
    if not jti:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token format",
        )

    # ── Token Rotation (Blacklist Check) ─────────────────
    if redis_client.get(f"bl:{jti}"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has been revoked",
        )

    # ── Revoke current token upon use ────────────────────
    exp = payload.get("exp")
    now = datetime.now(timezone.utc).timestamp()
    ttl = int(exp - now) if exp else 7 * 86400
    if ttl > 0:
        redis_client.setex(f"bl:{jti}", ttl, "revoked")

    user_id = payload.get("sub")
    user = db.query(User).filter(User.id == user_id).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    tokens = create_user_tokens(user)
    return tokens


# ── Current User Profile ─────────────────────────────────────

@router.get("/me", response_model=UserProfileResponse)
def get_me(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Return the currently authenticated user's profile.
    Used by frontend to determine role-based UI rendering.
    """
    sync_operator_duty_state(db, current_user, commit=True)
    skill_score = None
    if current_user.role == "operator":
        skill_score = get_operator_skill_snapshot(
            db,
            current_user.company_id,
            current_user,
            persist_score=True,
        )["skill_score"]

    return UserProfileResponse(
        id=str(current_user.id),
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        company_id=str(current_user.company_id),
        department=current_user.department,
        phone=current_user.phone,
        is_on_duty=current_user.is_on_duty,
        current_task_count=current_user.current_task_count,
        duty_expires_at=current_user.duty_expires_at,
        owner_feedback_score=float(current_user.owner_feedback_score or 3.0),
        operator_feedback_score=float(current_user.operator_feedback_score or 3.0),
        skill_score=skill_score,
        must_change_password=current_user.must_change_password,
    )


# ── Change Password ──────────────────────────────────────────

@router.post("/change-password")
def change_password(
    request: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Change the current user's password.

    WHY important:
    - New users get temp passwords → MUST change on first login
    - Enforces password policy (8+ chars, mixed case, digit, special)
    - Clears must_change_password flag after success
    """
    success, message = change_user_password(
        db, current_user, request.current_password, request.new_password
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message,
        )
    return {"message": message}


# ── Forgot & Reset Password ──────────────────────────────────

@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, data: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """
    Send a password reset link to the user's email if it exists.
    Always returns success to prevent email enumeration.
    """
    user = db.query(User).filter(User.email == data.email).first()
    if user and user.is_active:
        token = create_password_reset_token(user.email)
        # Using the frontend port (proxied or standard) since there is no BASE_URL setting.
        # Assuming Vite runs on localhost:5173 or the domain the app is deployed on.
        # For simplicity, using a hardcoded placeholder for dev, or the origin header.
        origin = request.headers.get("origin", "http://localhost:5173")
        reset_link = f"{origin}/reset-password?token={token}"
        email_sent, email_error = send_password_reset_email(user_email=user.email, reset_link=reset_link)
        if not email_sent:
            logger.warning("Password reset email was not delivered to %s: %s", user.email, email_error)
        
    return {"message": "If an account with that email exists, we sent a password reset link."}


@router.post("/reset-password")
@limiter.limit("5/minute")
def reset_password(request: Request, data: ResetPasswordRequest, db: Session = Depends(get_db)):
    """
    Reset password using a valid token and new password.
    """
    email = verify_password_reset_token(data.token)
    if not email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )
        
    user = db.query(User).filter(User.email == email).first()
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or expired reset token.",
        )
        
    # Validate new password strength
    is_valid, err = validate_password_strength(data.new_password)
    if not is_valid:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=err,
        )
        
    # Update password
    user.hashed_password = hash_password(data.new_password)
    user.must_change_password = False
    
    # We should invalidate active sessions, but since we use JWTs, 
    # we would need to increment a version or add all active JTI to blacklist.
    # For now, changing the password works.
    
    db.commit()
    return {"message": "Password has been successfully reset. You can now login."}
