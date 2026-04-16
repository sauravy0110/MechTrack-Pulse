"""
MechTrack Pulse — Client Management API Routes

Dedicated client handling for the CNC MES job-creation flow.
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.core.dependencies import require_password_changed, require_roles
from app.db.database import get_db
from app.models.client import Client
from app.models.user import User
from app.services.user_service import create_user

router = APIRouter()


class CreateClientRequest(BaseModel):
    company_name: str = Field(..., min_length=2, max_length=255)
    contact_person: str = Field(..., min_length=2, max_length=150)
    email: EmailStr
    phone: str | None = Field(None, max_length=15)
    address: str | None = Field(None, max_length=1000)
    send_email: bool = True


def _client_payload(client: Client) -> dict:
    user = client.user
    return {
        "id": str(user.id),
        "client_profile_id": str(client.id),
        "client_id": client.client_code,
        "username": user.email,
        "email": user.email,
        "full_name": user.full_name,
        "contact_person": client.contact_person,
        "company_name": client.company_name,
        "phone": user.phone,
        "address": client.address,
        "created_at": client.created_at.isoformat(),
    }


def _generate_client_code(db: Session, company_id: UUID) -> str:
    count = (
        db.query(Client)
        .filter(Client.company_id == company_id)
        .count()
    )
    return f"CL-{str(company_id).split('-')[0].upper()}-{count + 1:03d}"


@router.get("/", status_code=status.HTTP_200_OK)
def list_clients(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    if current_user.role == "client":
        profile = (
            db.query(Client)
            .filter(
                Client.company_id == current_user.company_id,
                Client.user_id == current_user.id,
            )
            .first()
        )
        return [_client_payload(profile)] if profile else []

    if current_user.role not in {"owner", "supervisor"}:
        raise HTTPException(status_code=403, detail="Access denied")

    clients = (
        db.query(Client)
        .filter(Client.company_id == current_user.company_id)
        .order_by(Client.created_at.desc())
        .all()
    )
    return [_client_payload(client) for client in clients]


@router.post("/", status_code=status.HTTP_201_CREATED)
def create_client(
    request: CreateClientRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    user, temp_password, error = create_user(
        db=db,
        company_id=current_user.company_id,
        email=request.email,
        full_name=request.contact_person,
        role="client",
        phone=request.phone,
        send_welcome_email=request.send_email,
    )
    if error or not user:
        raise HTTPException(status_code=400, detail=error or "Unable to create client")

    client = Client(
        company_id=current_user.company_id,
        user_id=user.id,
        client_code=_generate_client_code(db, current_user.company_id),
        company_name=request.company_name,
        contact_person=request.contact_person,
        address=request.address,
    )
    db.add(client)
    db.commit()
    db.refresh(client)

    payload = _client_payload(client)
    payload["temp_password"] = temp_password
    return payload
