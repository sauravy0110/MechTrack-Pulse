"""
MechTrack Pulse — Machine Management API Routes

Endpoints:
  POST   /api/v1/machines/              → Create machine
  GET    /api/v1/machines/              → List machines
  GET    /api/v1/machines/{id}          → Get machine detail
  PATCH  /api/v1/machines/{id}          → Update machine
  DELETE /api/v1/machines/{id}          → Delete machine
  GET    /api/v1/machines/{id}/tasks    → Get tasks on machine
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from sqlalchemy.orm import Session

from app.core.dependencies import RequirePermission, require_password_changed
from app.core.permissions import Permission
from app.db.database import get_db
from app.models.machine import Machine
from app.models.task import Task
from app.models.user import User
from app.schemas.machine import (
    CreateMachineRequest,
    MachineResponse,
    UpdateMachineRequest,
)
from app.schemas.task import TaskResponse
from app.api.v1.websocket import broadcast_machine_update, broadcast_notification

router = APIRouter()


def _machine_response(m: Machine) -> MachineResponse:
    return MachineResponse(
        id=str(m.id),
        name=m.name,
        machine_type=m.machine_type,
        grid_x=m.grid_x,
        grid_y=m.grid_y,
        status=m.status,
        created_at=m.created_at,
    )


@router.post("/", response_model=MachineResponse, status_code=status.HTTP_201_CREATED)
def create_machine(
    request: CreateMachineRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.CREATE_MACHINE)),
):
    """Create a new machine in the company."""
    # Check duplicate name
    existing = db.query(Machine).filter(
        Machine.company_id == current_user.company_id,
        Machine.name == request.name,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Machine name already exists in your company")

    # Check subscription machine limit
    from app.models.subscription import Subscription
    subscription = db.query(Subscription).filter(
        Subscription.company_id == current_user.company_id
    ).first()
    if subscription:
        current_count = db.query(Machine).filter(
            Machine.company_id == current_user.company_id
        ).count()
        if subscription.max_machines != -1 and current_count >= subscription.max_machines:
            raise HTTPException(
                status_code=400,
                detail=f"Machine limit reached ({subscription.max_machines}). Upgrade your plan.",
            )

    machine = Machine(
        company_id=current_user.company_id,
        name=request.name,
        machine_type=request.machine_type,
        grid_x=request.grid_x,
        grid_y=request.grid_y,
    )
    db.add(machine)
    db.commit()
    db.refresh(machine)
    background_tasks.add_task(
        broadcast_machine_update,
        current_user.company_id,
        _machine_response(machine).model_dump(),
    )
    return _machine_response(machine)


@router.get("/", response_model=list[MachineResponse])
def list_machines(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """List all machines in the company."""
    machines = db.query(Machine).filter(
        Machine.company_id == current_user.company_id
    ).order_by(Machine.created_at.desc()).all()
    return [_machine_response(m) for m in machines]


@router.get("/{machine_id}", response_model=MachineResponse)
def get_machine(
    machine_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Get machine details."""
    machine = db.query(Machine).filter(
        Machine.id == machine_id,
        Machine.company_id == current_user.company_id,
    ).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")
    return _machine_response(machine)


@router.patch("/{machine_id}", response_model=MachineResponse)
def update_machine(
    machine_id: UUID,
    request: UpdateMachineRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.UPDATE_MACHINE)),
):
    """Update machine details."""
    machine = db.query(Machine).filter(
        Machine.id == machine_id,
        Machine.company_id == current_user.company_id,
    ).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    updates = request.model_dump(exclude_unset=True)
    for field, value in updates.items():
        if value is not None:
            setattr(machine, field, value)

    db.commit()
    db.refresh(machine)

    background_tasks.add_task(
        broadcast_machine_update,
        current_user.company_id,
        _machine_response(machine).model_dump(),
    )
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"Machine '{machine.name}' updated.",
        "info",
    )

    return _machine_response(machine)


@router.delete("/{machine_id}")
def delete_machine(
    machine_id: UUID,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(RequirePermission(Permission.DELETE_MACHINE)),
):
    """Delete a machine. Tasks on this machine lose their machine_id."""
    machine = db.query(Machine).filter(
        Machine.id == machine_id,
        Machine.company_id == current_user.company_id,
    ).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    db.delete(machine)
    db.commit()
    background_tasks.add_task(
        broadcast_notification,
        current_user.company_id,
        f"Machine '{machine.name}' deleted.",
        "info",
    )
    return {"message": f"Machine '{machine.name}' deleted"}


@router.get("/{machine_id}/tasks", response_model=list[TaskResponse])
def get_machine_tasks(
    machine_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Get all tasks assigned to a machine."""
    machine = db.query(Machine).filter(
        Machine.id == machine_id,
        Machine.company_id == current_user.company_id,
    ).first()
    if not machine:
        raise HTTPException(status_code=404, detail="Machine not found")

    tasks = db.query(Task).filter(
        Task.machine_id == machine_id,
        Task.company_id == current_user.company_id,
    ).order_by(Task.created_at.desc()).all()

    return [
        TaskResponse(
            id=str(t.id),
            title=t.title,
            description=t.description,
            status=t.status,
            priority=t.priority,
            assigned_to=str(t.assigned_to) if t.assigned_to else None,
            client_id=str(t.client_id) if t.client_id else None,
            created_by=str(t.created_by),
            machine_id=str(t.machine_id) if t.machine_id else None,
            estimated_completion=t.estimated_completion,
            actual_completion=t.actual_completion,
            delay_probability=t.delay_probability,
            total_time_spent_seconds=t.total_time_spent_seconds,
            timer_started_at=t.timer_started_at,
            delay_reason=t.delay_reason,
            created_at=t.created_at,
            updated_at=t.updated_at,
        )
        for t in tasks
    ]
