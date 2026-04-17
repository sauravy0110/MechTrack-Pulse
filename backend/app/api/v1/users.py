"""
MechTrack Pulse — User Management API Routes

Endpoints:
  POST   /api/v1/users/                    → Create user (owner only)
  GET    /api/v1/users/                    → List users in company
  GET    /api/v1/users/{id}                → Get user detail
  PATCH  /api/v1/users/{id}                → Update user
  DELETE /api/v1/users/{id}                → Deactivate user (soft delete)
  POST   /api/v1/users/{id}/reactivate     → Reactivate user
  DELETE /api/v1/users/{id}/permanent       → Permanently remove user

SECURITY:
  - company_id comes from JWT token (tenant isolation)
  - Only owner can create/deactivate users
  - Owner + supervisor can list/view users
"""

from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.core.dependencies import RequirePermission, require_roles
from app.core.permissions import Permission, can_create_role
from app.db.database import get_db
from app.models.user import User
from app.api.v1.websocket import broadcast_user_update
from app.services.audit_service import record_audit_log
from app.schemas.user import (
    CreateUserRequest,
    CreateUserResponse,
    UpdateUserRequest,
    UserResponse,
)
from app.services.user_service import (
    create_user,
    deactivate_user,
    get_user,
    list_users,
    reactivate_user,
    remove_user,
    update_user,
)
from app.services.operator_service import get_operator_skill_snapshot, sync_company_operator_states, sync_operator_duty_state

router = APIRouter()


def _user_to_response(db: Session, user: User) -> UserResponse:
    if user.role == "operator":
        sync_operator_duty_state(db, user)
    skill_score = None
    if user.role == "operator":
        skill_score = get_operator_skill_snapshot(
            db=db,
            company_id=user.company_id,
            operator=user,
            persist_score=True,
        )["skill_score"]
    return UserResponse(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        department=user.department,
        phone=user.phone,
        is_active=user.is_active,
        is_on_duty=user.is_on_duty,
        current_task_count=user.current_task_count,
        last_active_at=user.last_active_at,
        duty_expires_at=user.duty_expires_at,
        owner_feedback_score=float(user.owner_feedback_score or 3.0),
        operator_feedback_score=float(user.operator_feedback_score or 3.0),
        skill_score=skill_score,
        must_change_password=user.must_change_password,
        last_login_at=user.last_login_at,
        created_at=user.created_at,
    )


# ── Create User ──────────────────────────────────────────────

@router.post("/", response_model=CreateUserResponse, status_code=status.HTTP_201_CREATED)
def create_user_route(
    request: CreateUserRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.INVITE_USER)),
):
    """
    Create a new user in the owner's company.
    Generates a temp password — send to user via SMS/email.
    company_id is taken from JWT, NOT from request body.
    """
    if not can_create_role(current_user.role, request.role):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"{current_user.role.capitalize()} cannot create {request.role} users",
        )

    user, temp_password, error = create_user(
        db=db,
        company_id=current_user.company_id,
        email=request.email,
        full_name=request.full_name,
        role=request.role,
        phone=request.phone,
        department=request.department,
    )
    if error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=error)

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="user.created",
        resource_type="user",
        resource_id=user.id,
        details={"email": user.email, "role": user.role},
    )
    db.commit()
    background_tasks.add_task(
        broadcast_user_update,
        current_user.company_id,
        _user_to_response(db, user).model_dump(),
    )

    return CreateUserResponse(
        id=str(user.id),
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        company_id=str(user.company_id),
        temp_password=temp_password,
        must_change_password=user.must_change_password,
    )


# ── List Users ───────────────────────────────────────────────

@router.get("/", response_model=list[UserResponse])
def list_users_route(
    role: str | None = Query(None, description="Filter by role"),
    include_inactive: bool = Query(False, description="Include deactivated users"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """List all users in the current user's company."""
    users = list_users(
        db=db,
        company_id=current_user.company_id,
        role_filter=role,
        active_only=not include_inactive,
    )
    sync_company_operator_states(db, current_user.company_id)
    return [_user_to_response(db, u) for u in users]


# ── Get User Detail ──────────────────────────────────────────

@router.get("/{user_id}", response_model=UserResponse)
def get_user_route(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Get a specific user in the current company."""
    user = get_user(db, current_user.company_id, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    return _user_to_response(db, user)


# ── Update User ──────────────────────────────────────────────

@router.patch("/{user_id}", response_model=UserResponse)
def update_user_route(
    user_id: UUID,
    request: UpdateUserRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.INVITE_USER)),
):
    """Update user details. Only owner can modify users."""
    updates = request.model_dump(exclude_unset=True)
    user, error = update_user(db, current_user.company_id, user_id, updates)
    if error:
        raise HTTPException(status_code=400, detail=error)

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="user.updated",
        resource_type="user",
        resource_id=user.id,
        details={"fields": list(updates.keys())},
    )
    db.commit()
    background_tasks.add_task(
        broadcast_user_update,
        current_user.company_id,
        _user_to_response(db, user).model_dump(),
    )

    return _user_to_response(db, user)


# ── Deactivate User ─────────────────────────────────────────

@router.delete("/{user_id}")
def deactivate_user_route(
    user_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.DELETE_USER)),
):
    """Soft-delete a user. Decrements subscription usage counter."""
    user = get_user(db, current_user.company_id, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    success, message = deactivate_user(db, current_user.company_id, user_id)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="user.deactivated",
        resource_type="user",
        resource_id=user.id,
        details={"email": user.email, "role": user.role},
    )
    db.commit()
    background_tasks.add_task(
        broadcast_user_update,
        current_user.company_id,
        _user_to_response(db, user).model_dump(),
    )
    return {"message": message}


# ── Reactivate User ─────────────────────────────────────────

@router.post("/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user_route(
    user_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner")),
):
    """Reactivate a deactivated user. Owner only."""
    user, error = reactivate_user(db, current_user.company_id, user_id)
    if error:
        raise HTTPException(status_code=400, detail=error)

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="user.reactivated",
        resource_type="user",
        resource_id=user.id,
        details={"email": user.email, "role": user.role},
    )
    db.commit()
    background_tasks.add_task(
        broadcast_user_update,
        current_user.company_id,
        _user_to_response(db, user).model_dump(),
    )
    return _user_to_response(db, user)


# ── Permanently Remove User ─────────────────────────────────

@router.delete("/{user_id}/permanent")
def remove_user_route(
    user_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner")),
):
    """Permanently remove a user and all their associated data. Owner only. Irreversible."""
    from app.services.user_service import get_user_include_inactive
    user = get_user_include_inactive(db, current_user.company_id, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user_name = user.full_name
    user_email = user.email
    user_role = user.role

    success, message = remove_user(db, current_user.company_id, user_id)
    if not success:
        raise HTTPException(status_code=400, detail=message)

    record_audit_log(
        db,
        company_id=current_user.company_id,
        actor=current_user,
        action="user.removed",
        resource_type="user",
        resource_id=user_id,
        details={"email": user_email, "role": user_role, "permanent": True},
    )
    db.commit()
    from app.api.v1.websocket import broadcast_notification
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"User '{user_name}' has been permanently removed.",
        "info",
    )
    return {"message": f"User '{user_name}' permanently removed"}
