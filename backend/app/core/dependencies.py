"""
MechTrack Pulse — Shared FastAPI Dependencies

WHY: Reusable dependencies injected into route handlers.
- get_current_user: extracts user from JWT, enforces auth
- require_roles: role-based access control decorator
- get_company_id: tenant isolation — extracts company from token

These are used across ALL routes. Centralizing them here
avoids duplication and ensures consistent auth behavior.
"""

from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.redis import redis_client
from app.core.security import decode_token
from app.db.database import get_db
from app.models.user import User
from app.core.permissions import Permission, has_permission

settings = get_settings()

# ── OAuth2 scheme (reads token from Authorization header) ────
oauth2_scheme = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login",
    auto_error=False,
)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
):
    """
    Decode JWT → load user from DB → return user object.
    Raises 401 if token invalid or user not found/inactive.

    CRITICAL: If must_change_password is True, this blocks
    ALL API access. The only allowed endpoint is /change-password.
    The route itself must check and skip this — see require_password_changed.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_token(token)
    if payload is None:
        raise credentials_exception

    user_id: str = payload.get("sub")
    token_type: str = payload.get("type")

    if user_id is None or token_type != "access":
        raise credentials_exception

    user = db.query(User).filter(User.id == user_id).first()
    if user is None or not user.is_active:
        raise credentials_exception

    return user


async def require_password_changed(
    current_user=Depends(get_current_user),
):
    """
    Dependency that blocks users who haven't changed their temp password.

    WHY: Users with must_change_password=True should ONLY be able
    to call /auth/change-password. All other endpoints use this
    dependency to enforce that.

    Usage:
        @router.get("/tasks")
        def list_tasks(user = Depends(require_password_changed)):
            ...
    """
    if current_user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Password change required. Please change your temporary password before accessing the system.",
        )
    return current_user


class RequirePermission:
    """
    FastAPI Dependency to check if the current user possesses a specific explicit permission.
    Example: Depends(RequirePermission(Permission.CREATE_TASK))
    """
    def __init__(self, permission: Permission):
        self.permission = permission

    def __call__(self, current_user: User = Depends(require_password_changed)) -> User:
        if not has_permission(current_user.role, self.permission):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied. Required capability: {self.permission.value}",
            )
        return current_user


def require_roles(*allowed_roles: str):
    """
    Dependency factory for role-based access control.

    Usage:
        @router.get("/admin-only")
        def admin_route(user = Depends(require_roles("owner", "supervisor"))):
            ...

    WHY a factory: Different routes need different role sets.

    CHAINS: require_password_changed → get_current_user
    So users with must_change_password=True are auto-blocked.
    """
    async def role_checker(current_user=Depends(require_password_changed)):
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Access denied. Required roles: {', '.join(allowed_roles)}",
            )
        return current_user
    return role_checker


def get_company_id(current_user=Depends(get_current_user)) -> UUID:
    """
    Extract company_id from the authenticated user.

    WHY: Tenant isolation — every query must be scoped.
    This is injected into service functions to ensure
    no cross-company data leaks.
    """
    return current_user.company_id
