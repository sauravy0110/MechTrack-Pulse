import pytest
import uuid
from tests.utils import register_company, approve_company, login_user, create_user, create_machine, create_task

def test_websocket_connection_and_broadcast(client, platform_admin_token):
    """Test WebSocket connection and task update broadcast."""
    # 1. Setup
    email = f"ws_owner_{uuid.uuid4().hex[:8]}@test.com"
    company_id = register_company(client, email=email)
    temp_password = approve_company(client, platform_admin_token, company_id, email=email)
    owner_token = login_user(client, email, temp_password)
    
    # OWNER MUST CHANGE PASSWORD
    client.post("/api/v1/auth/change-password", headers={"Authorization": f"Bearer {owner_token}"}, json={
        "current_password": temp_password,
        "new_password": "OwnerPassword123!"
    })
    owner_token = login_user(client, email, "OwnerPassword123!")
    
    op_email = f"ws_op_{uuid.uuid4().hex[:8]}@test.com"
    op_data = create_user(client, owner_token, "WS Operator", op_email, "operator")
    op_id = op_data["id"]
    op_pass_temp = op_data["temp_password"]
    
    mach_data = create_machine(client, owner_token, "WS Machine")
    mach_id = mach_data["id"]
    
    # 1.1 Operator MUST change password and go On-Duty
    op_token = login_user(client, op_email, op_pass_temp)
    client.post("/api/v1/auth/change-password", headers={"Authorization": f"Bearer {op_token}"}, json={
        "current_password": op_pass_temp,
        "new_password": "OpPassword123!"
    })
    op_token = login_user(client, op_email, "OpPassword123!")
    client.post("/api/v1/operator/toggle-duty", headers={"Authorization": f"Bearer {op_token}"})

    # 2. Connect WebSocket as owner
    ws_url = f"/api/v1/ws/{company_id}?token={owner_token}"
    with client.websocket_connect(ws_url) as websocket:
        # 3. Create a task (triggers background broadcast)
        task_data = create_task(client, owner_token, "WS Task", mach_id, op_id)
        task_id = task_data["id"]
        
        # 4. Update status (triggers background broadcast)
        client.patch(f"/api/v1/tasks/{task_id}/status", headers={"Authorization": f"Bearer {owner_token}"}, params={
            "new_status": "in_progress"
        })
        
        # Test heartbeat/ping to ensure connection is still alive
        websocket.send_json({"type": "ping"})
        
        received_types = []
        # Receive until we get the ack or a reasonable limit
        for _ in range(5):
            data = websocket.receive_json()
            received_types.append(data["type"])
            if data["type"] == "ack":
                break
                
        assert "task_update" in received_types
        assert "ack" in received_types
