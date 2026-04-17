import pytest
import uuid
from tests.utils import register_company, approve_company, login_user, create_user, create_machine, create_task

@pytest.fixture
def setup_owner_and_operator(client, platform_admin_token):
    """Fixture to setup a company, owner, and operator."""
    # 1. Company & Owner
    email = f"owner_{uuid.uuid4().hex[:8]}@test.com"
    company_id = register_company(client, email=email)
    temp_password = approve_company(client, platform_admin_token, company_id, email=email)
    owner_token = login_user(client, email, temp_password)
    
    # OWNER MUST CHANGE PASSWORD
    client.post("/api/v1/auth/change-password", headers={"Authorization": f"Bearer {owner_token}"}, json={
        "current_password": temp_password,
        "new_password": "OwnerPassword123!"
    })
    owner_token = login_user(client, email, "OwnerPassword123!")
    
    # 2. Operator
    op_email = f"op_{uuid.uuid4().hex[:8]}@test.com"
    op_data = create_user(client, owner_token, "Test Operator", op_email, "operator")
    op_pass = op_data["temp_password"]
    op_id = op_data["id"]
    
    # 3. Machine
    mach_data = create_machine(client, owner_token, "Lathe 01")
    mach_id = mach_data["id"]
    
    # 4. Operator Login & On-Duty
    op_token = login_user(client, op_email, op_pass)
    res = client.post("/api/v1/auth/change-password", headers={"Authorization": f"Bearer {op_token}"}, json={
        "current_password": op_pass,
        "new_password": "OpPassword123!"
    })
    op_token = login_user(client, op_email, "OpPassword123!")
    
    return {
        "owner_token": owner_token,
        "op_token": op_token,
        "op_id": op_id,
        "mach_id": mach_id
    }

def test_task_lifecycle(client, setup_owner_and_operator):
    """Test full task assignment and completion lifecycle."""
    s = setup_owner_and_operator
    
    # 1. Assign Task
    task_data = create_task(client, s["owner_token"], "Turn Metal Part A", s["mach_id"], s["op_id"])
    task_id = task_data["id"]
    # If operator had no tasks, first one becomes 'in_progress' automatically
    assert task_data["status"] == "in_progress"
    
    import time
    time.sleep(1.1)
    
    # 2. Operator completes task
    res = client.patch(f"/api/v1/tasks/{task_id}/status", headers={"Authorization": f"Bearer {s['op_token']}"}, params={
        "new_status": "completed"
    })
    assert res.status_code == 200
    assert res.json()["status"] == "completed"
    assert res.json()["total_time_spent_seconds"] > 0

def test_off_duty_operator_assignment_fails(client, setup_owner_and_operator):
    """Edge Case: Test that off-duty operator cannot be assigned a task."""
    s = setup_owner_and_operator
    
    # Toggle operator off-duty
    client.post("/api/v1/operator/toggle-duty", headers={"Authorization": f"Bearer {s['op_token']}"})
    
    # Attempt to assign task
    res = client.post("/api/v1/tasks/", headers={"Authorization": f"Bearer {s['owner_token']}"}, json={
        "title": "Should Fail",
        "priority": "medium",
        "machine_id": s["mach_id"],
        "assigned_to": s["op_id"]
    })
    assert res.status_code == 400
    assert "off-duty" in res.text

def test_unassigned_operator_status_change_fails(client, setup_owner_and_operator):
    """Edge Case: Test that operator cannot update task not assigned to them."""
    s = setup_owner_and_operator
    
    # 1. Create task assigned to another operator (or no one)
    task_data = create_task(client, s["owner_token"], "Other Task", s["mach_id"], None)
    task_id = task_data["id"]
    
    # 2. Operator attempts to update
    res = client.patch(f"/api/v1/tasks/{task_id}/status", headers={"Authorization": f"Bearer {s['op_token']}"}, params={
        "new_status": "in_progress"
    })
    assert res.status_code == 403
