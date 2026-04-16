import uuid
from fastapi.testclient import TestClient

def register_company(client: TestClient, name: str = "Test Corp", email: str = None):
    """Register a new company and return its ID."""
    if email is None:
        email = f"owner_{uuid.uuid4().hex[:8]}@test.com"
    res = client.post("/api/v1/companies/register", json={
        "company_name": name,
        "gst_number": f"22AAAAA{uuid.uuid4().hex[:5].upper()}1Z5",
        "msme_number": f"UDYAM-MH-00-{uuid.uuid4().hex[:7]}",
        "industry_type": "Manufacturing",
        "address": "123 Industrial Rd",
        "city": "Mumbai",
        "state": "MH",
        "owner_name": "Test Owner",
        "owner_email": email,
        "owner_phone": "+919876543210"
    })
    assert res.status_code == 201
    return res.json()["company_id"]

def approve_company(client: TestClient, admin_token: str, company_id: int, email: str = "owner@test.com"):
    """Approve a company as platform admin and return the temporary password."""
    from app.api.v1 import platform as platform_api

    original_send_owner_welcome_email = platform_api.send_owner_welcome_email
    platform_api.send_owner_welcome_email = lambda **_kwargs: (False, "disabled in tests")
    try:
        res = client.patch(f"/api/v1/platform/companies/{company_id}/approve", headers={
            "Authorization": f"Bearer {admin_token}"
        }, json={
            "owner_name": "Test Owner",
            "owner_email": email,
            "owner_phone": "+919876543210"
        })
    finally:
        platform_api.send_owner_welcome_email = original_send_owner_welcome_email

    assert res.status_code == 200
    return res.json()["temp_password"]

def login_user(client: TestClient, email: str, password: str):
    """Login a user and return the access token."""
    res = client.post("/api/v1/auth/login", json={
        "email": email,
        "password": password
    })
    assert res.status_code == 200
    return res.json()["access_token"]

def create_user(client: TestClient, owner_token: str, full_name: str, email: str = None, role: str = "operator"):
    """Create a new user (operator, client, etc.) and return the user data."""
    if email is None:
        email = f"user_{uuid.uuid4().hex[:8]}@test.com"
    res = client.post("/api/v1/users/", headers={
        "Authorization": f"Bearer {owner_token}"
    }, json={
        "full_name": full_name,
        "email": email,
        "phone": "+918888888888",
        "role": role
    })
    assert res.status_code == 201
    return res.json()

def create_machine(client: TestClient, owner_token: str, name: str = "Test Machine"):
    """Create a new machine and return its data."""
    res = client.post("/api/v1/machines/", headers={
        "Authorization": f"Bearer {owner_token}"
    }, json={
        "name": name,
        "machine_type": "Lathe",
        "grid_x": 1,
        "grid_y": 1
    })
    assert res.status_code in (200, 201)
    return res.json()

def create_task(client: TestClient, owner_token: str, title: str, machine_id: int, operator_id: int):
    """Create a new task and return its data."""
    res = client.post("/api/v1/tasks/", headers={
        "Authorization": f"Bearer {owner_token}"
    }, json={
        "title": title,
        "priority": "medium",
        "machine_id": machine_id,
        "assigned_to": operator_id
    })
    assert res.status_code in (200, 201)
    return res.json()
