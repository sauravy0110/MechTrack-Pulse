"""
MechTrack Pulse — Granular Permission Matrix

Replaces broad role checks (e.g. `role == "owner"`) with explicit capabilities.
This enables enterprise features like creating custom roles or restricting
supervisors from certain destructive actions.
"""

from enum import Enum

class Permission(str, Enum):
    # Tasks
    CREATE_TASK = "create_task"
    UPDATE_TASK = "update_task"       # Edit details
    DELETE_TASK = "delete_task"
    ASSIGN_TASK = "assign_task"
    UPDATE_TASK_STATUS = "update_task_status"
    
    # Machines
    CREATE_MACHINE = "create_machine"
    UPDATE_MACHINE = "update_machine"
    DELETE_MACHINE = "delete_machine"
    
    # Users & Company
    INVITE_USER = "invite_user"
    DELETE_USER = "delete_user"
    MANAGE_BILLING = "manage_billing"
    
    # Read Access (Mostly handled implicitly, but good for custom roles)
    VIEW_DASHBOARD = "view_dashboard"


# Default Role-to-Permission Mapping
ROLE_PERMISSIONS: dict[str, set[Permission]] = {
    "owner": {
        Permission.CREATE_TASK,
        Permission.UPDATE_TASK,
        Permission.DELETE_TASK,
        Permission.ASSIGN_TASK,
        Permission.UPDATE_TASK_STATUS,
        Permission.CREATE_MACHINE,
        Permission.UPDATE_MACHINE,
        Permission.DELETE_MACHINE,
        Permission.INVITE_USER,
        Permission.DELETE_USER,
        Permission.MANAGE_BILLING,
        Permission.VIEW_DASHBOARD,
    },
    "supervisor": {
        Permission.CREATE_TASK,
        Permission.UPDATE_TASK,
        Permission.ASSIGN_TASK,
        Permission.UPDATE_TASK_STATUS,
        Permission.CREATE_MACHINE,
        Permission.UPDATE_MACHINE,
        Permission.INVITE_USER,
        Permission.VIEW_DASHBOARD,
    },
    "operator": {
        # Operators have extremely limited global permissions.
        # Logic-level checks ensure they only update their *own* tasks.
        Permission.UPDATE_TASK_STATUS,
        Permission.VIEW_DASHBOARD,
    },
    "client": {
        Permission.VIEW_DASHBOARD,
    }
}

ROLE_CREATE_ALLOWLIST: dict[str, set[str]] = {
    "owner": {"supervisor", "operator", "client"},
    "supervisor": {"operator"},
}


def has_permission(role: str, permission: Permission) -> bool:
    """Check if a specific role possesses a permission."""
    return permission in ROLE_PERMISSIONS.get(role, set())


def can_create_role(actor_role: str, target_role: str) -> bool:
    """Check whether one role is allowed to create another."""
    return target_role in ROLE_CREATE_ALLOWLIST.get(actor_role, set())
