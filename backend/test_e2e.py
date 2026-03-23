import os
import sys
import uuid
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Set up test env before importing main
os.environ["DATABASE_URL"] = "postgresql+psycopg://postgres:postgres@localhost:5432/mechtrack_test"
os.environ["SECRET_KEY"] = "testsecret"
os.environ["JWT_SECRET_KEY"] = "testsecret"

sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.main import app
from app.db.database import Base, get_db

# Create test DB
engine = create_engine("postgresql+psycopg://postgres:postgres@localhost:5432/mechtrack_test")
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.drop_all(bind=engine)
from sqlalchemy import text
with engine.begin() as conn:
    conn.execute(text("DROP TYPE IF EXISTS status_enum CASCADE;"))
    conn.execute(text("DROP TYPE IF EXISTS priority_enum CASCADE;"))
    conn.execute(text("DROP TYPE IF EXISTS role_enum CASCADE;"))
Base.metadata.create_all(bind=engine)

# Seed platform admin in test DB
from app.services.auth_service import seed_platform_admin
db = TestingSessionLocal()
seed_platform_admin(db)
db.close()

def override_get_db():
    try:
        db = TestingSessionLocal()
        yield db
    finally:
        db.close()

app.dependency_overrides[get_db] = override_get_db

client = TestClient(app)

def run_tests():
    print("🚀 Starting MechTrack Pulse E2E Testing...")

    # 1. Platform Admin Seed test
    print("✔️ DB Seeded automatically.")
    
    # 2. Company Register
    res = client.post("/api/v1/companies/register", json={
        "company_name": "E2E Test Corp",
        "gst_number": "22AAAAA0000A1Z5",
        "msme_number": "UDYAM-MH-00-1234567",
        "industry_type": "Manufacturing",
        "address": "123 Industrial Rd",
        "city": "Mumbai",
        "state": "MH",
        "owner_name": "Ratan Tata",
        "owner_email": "owner@e2e.com",
        "owner_phone": "+919876543210"
    })
    assert res.status_code == 201, f"Company Register Failed: {res.text}"
    company_id = res.json()["company_id"]
    print(f"✔️ Company Registered (ID: {company_id})")

    # 3. Platform Admin Login & Approve
    res = client.post("/api/v1/platform/login", json={
        "email": "admin@mechtrackpulse.com",
        "password": "Admin@12345"
    })
    assert res.status_code == 200, f"Platform Admin Login Failed: {res.text}"
    admin_token = res.json()["access_token"]
    
    res = client.patch(f"/api/v1/platform/companies/{company_id}/approve", headers={
        "Authorization": f"Bearer {admin_token}"
    }, json={
        "owner_name": "Ratan Tata",
        "owner_email": "owner@e2e.com",
        "owner_phone": "+919876543210"
    })
    assert res.status_code == 200, f"Approve Failed: {res.text}"
    temp_pass = res.json()["temp_password"]
    print("✔️ Platform Admin Approved Company")

    # 4. Owner Login & Password Change
    res = client.post("/api/v1/auth/login", json={
        "email": "owner@e2e.com",
        "password": temp_pass
    })
    assert res.status_code == 200, f"Owner Login Failed: {res.text}"
    owner_token = res.json()["access_token"]

    res = client.post("/api/v1/auth/change-password", headers={
        "Authorization": f"Bearer {owner_token}"
    }, json={
        "current_password": temp_pass,
        "new_password": "SecurePassword123!"
    })
    assert res.status_code == 200, f"Change Password Failed: {res.text}"
    
    # Relogin with new password
    res = client.post("/api/v1/auth/login", json={
        "email": "owner@e2e.com",
        "password": "SecurePassword123!"
    })
    owner_token = res.json()["access_token"]
    print("✔️ Owner Logged In & Changed Password")

    # 5. Create Operator
    res = client.post("/api/v1/users/", headers={
        "Authorization": f"Bearer {owner_token}"
    }, json={
        "full_name": "Test Operator",
        "email": "operator@e2e.com",
        "phone": "+918888888888",
        "role": "operator"
    })
    assert res.status_code == 201, f"Create Operator Failed: {res.text}"
    op_pass = res.json()["temp_password"]
    op_id = res.json()["id"]
    print("✔️ Operator created")

    # 6. Operator Login & Toggle Duty
    res = client.post("/api/v1/auth/login", json={
        "email": "operator@e2e.com",
        "password": op_pass
    })
    op_token = res.json()["access_token"]
    
    res = client.post("/api/v1/auth/change-password", headers={
        "Authorization": f"Bearer {op_token}"
    }, json={"current_password": op_pass, "new_password": "OpPassword123!"})

    res = client.post("/api/v1/auth/login", json={"email": "operator@e2e.com", "password": "OpPassword123!"})
    op_token = res.json()["access_token"]

    res = client.post("/api/v1/operator/toggle-duty", headers={"Authorization": f"Bearer {op_token}"})
    assert res.status_code == 200, f"Duty Toggle Failed: {res.text}"
    print("✔️ Operator Logged in & On Duty")

    # 7. Create Machine & Task
    res = client.post("/api/v1/machines/", headers={"Authorization": f"Bearer {owner_token}"}, json={
        "name": "Lathe 01",
        "machine_type": "Lathe",
        "grid_x": 5,
        "grid_y": 5
    })
    assert res.status_code in (200, 201), f"Create Machine Failed: {res.text}"
    mach_id = res.json()["id"]

    res = client.post("/api/v1/tasks/", headers={"Authorization": f"Bearer {owner_token}"}, json={
        "title": "Turn Metal Part A",
        "priority": "high",
        "machine_id": mach_id,
        "assigned_to": op_id
    })
    assert res.status_code in (200, 201), f"Create Task Failed: {res.text}"
    task_id = res.json()["id"]
    print("✔️ Task and Machine Created")

    # 8. Operator changes Task Status to 'in_progress' and then 'completed'
    res = client.patch(f"/api/v1/tasks/{task_id}/status", headers={"Authorization": f"Bearer {op_token}"}, params={
        "new_status": "in_progress"
    })
    assert res.status_code == 200, f"Task Start Failed: {res.text}"
    
    res = client.patch(f"/api/v1/tasks/{task_id}/status", headers={"Authorization": f"Bearer {op_token}"}, params={
        "new_status": "completed"
    })
    assert res.status_code == 200, f"Task Complete Failed: {res.text}"
    print("✔️ Task Lifecycle Completed via Operator")

    # 9. Test Owner KPI Dashboard
    res = client.get("/api/v1/owner/kpi", headers={"Authorization": f"Bearer {owner_token}"})
    assert res.status_code == 200, f"Owner KPI Failed: {res.text}"
    print(f"✔️ Owner KPI Dashboard: {res.json()}")

    print("✅ E2E Testing PASS. System is solid.")

if __name__ == "__main__":
    run_tests()
