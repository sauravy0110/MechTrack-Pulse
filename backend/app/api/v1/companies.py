"""
MechTrack Pulse — Company Registration (Public Route)

This is the ONLY public endpoint (besides login).
Anyone can register a company — it starts as 'pending'.

Endpoint:
  POST /api/v1/companies/register  → Register company
  GET  /api/v1/companies/{id}/status → Check registration status
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.schemas.company import (
    CompanyRegisterRequest,
    CompanyStatusResponse,
)
from app.models.company import Company
from app.services.auth_service import register_company

router = APIRouter()


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register_company_route(
    request: CompanyRegisterRequest,
    db: Session = Depends(get_db),
):
    """
    Register a new company. Status starts as 'pending'.
    Platform Admin must approve before the company can use the system.
    """
    company, error = register_company(
        db=db,
        company_name=request.company_name,
        gst_number=request.gst_number,
        msme_number=request.msme_number,
        industry_type=request.industry_type,
        address=request.address,
        city=request.city,
        state=request.state,
        owner_name=request.owner_name,
        owner_email=request.owner_email,
        owner_phone=request.owner_phone,
    )
    if not company:
        raise HTTPException(status_code=400, detail=error)

    return {
        "message": "Company registered successfully. Awaiting approval.",
        "company_id": str(company.id),
        "status": company.status,
    }


@router.get("/{company_id}/status", response_model=CompanyStatusResponse)
def check_status(company_id: UUID, db: Session = Depends(get_db)):
    """Check company registration status (public — no auth needed)."""
    company = db.query(Company).filter(Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    return CompanyStatusResponse(
        id=str(company.id),
        name=company.name,
        status=company.status,
    )
