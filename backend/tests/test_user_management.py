from tests.utils import (
    approve_company,
    create_user,
    login_user,
    register_company,
)


def _change_password(client, token: str, current_password: str, new_password: str):
    res = client.post(
        "/api/v1/auth/change-password",
        headers={"Authorization": f"Bearer {token}"},
        json={
            "current_password": current_password,
            "new_password": new_password,
        },
    )
    assert res.status_code == 200


def test_owner_can_create_supervisor_and_supervisor_can_only_create_operator(client, platform_admin_token):
    owner_email = "hierarchy_owner@test.com"
    company_id = register_company(client, email=owner_email)
    owner_temp_password = approve_company(client, platform_admin_token, company_id, email=owner_email)
    owner_token = login_user(client, owner_email, owner_temp_password)
    _change_password(client, owner_token, owner_temp_password, "OwnerPassword123!")
    owner_token = login_user(client, owner_email, "OwnerPassword123!")

    supervisor_email = "line_supervisor@test.com"
    supervisor = create_user(client, owner_token, "Line Supervisor", supervisor_email, "supervisor")
    assert supervisor["role"] == "supervisor"
    assert supervisor["temp_password"]

    supervisor_token = login_user(client, supervisor_email, supervisor["temp_password"])
    _change_password(client, supervisor_token, supervisor["temp_password"], "SupervisorPassword123!")
    supervisor_token = login_user(client, supervisor_email, "SupervisorPassword123!")

    operator_email = "shift_operator@test.com"
    operator = create_user(client, supervisor_token, "Shift Operator", operator_email, "operator")
    assert operator["role"] == "operator"

    res = client.post(
        "/api/v1/users/",
        headers={"Authorization": f"Bearer {supervisor_token}"},
        json={
            "full_name": "Another Supervisor",
            "email": "another_supervisor@test.com",
            "role": "supervisor",
        },
    )
    assert res.status_code == 403
    assert "cannot create supervisor" in res.json()["detail"].lower()


def test_client_only_sees_own_jobs_and_cannot_update_status(client, platform_admin_token):
    owner_email = "client_scope_owner@test.com"
    company_id = register_company(client, email=owner_email)
    owner_temp_password = approve_company(client, platform_admin_token, company_id, email=owner_email)
    owner_token = login_user(client, owner_email, owner_temp_password)
    _change_password(client, owner_token, owner_temp_password, "OwnerPassword123!")
    owner_token = login_user(client, owner_email, "OwnerPassword123!")

    client_email = "plant_client@test.com"
    client_user = create_user(client, owner_token, "Plant Client", client_email, "client")
    client_token = login_user(client, client_email, client_user["temp_password"])
    _change_password(client, client_token, client_user["temp_password"], "ClientPassword123!")
    client_token = login_user(client, client_email, "ClientPassword123!")

    other_client = create_user(client, owner_token, "Other Client", "other_client@test.com", "client")

    own_task_res = client.post(
        "/api/v1/tasks/",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Client-visible job",
            "priority": "medium",
            "client_id": client_user["id"],
        },
    )
    assert own_task_res.status_code == 201
    own_task_id = own_task_res.json()["id"]

    other_task_res = client.post(
        "/api/v1/tasks/",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Other client job",
            "priority": "medium",
            "client_id": other_client["id"],
        },
    )
    assert other_task_res.status_code == 201

    list_res = client.get(
        "/api/v1/tasks/",
        headers={"Authorization": f"Bearer {client_token}"},
    )
    assert list_res.status_code == 200
    tasks = list_res.json()
    assert len(tasks) == 1
    assert tasks[0]["id"] == own_task_id

    status_res = client.patch(
        f"/api/v1/tasks/{own_task_id}/status",
        headers={"Authorization": f"Bearer {client_token}"},
        params={"new_status": "in_progress"},
    )
    assert status_res.status_code == 403
    assert "clients cannot update task status" in status_res.json()["detail"].lower()
