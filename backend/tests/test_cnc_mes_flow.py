import uuid

from app.services.cnc_ai_service import _build_specs_from_ocr_payload, _normalize_ocr_payload
from tests.utils import approve_company, create_machine, create_task, create_user, login_user, register_company


def bootstrap_company(client, platform_admin_token):
    owner_email = f"owner_{uuid.uuid4().hex[:8]}@test.com"
    company_id = register_company(client, email=owner_email)
    temp_password = approve_company(client, platform_admin_token, company_id, email=owner_email)
    owner_token = login_user(client, owner_email, temp_password)

    client.post(
        "/api/v1/auth/change-password",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"current_password": temp_password, "new_password": "OwnerPassword123!"},
    )
    owner_token = login_user(client, owner_email, "OwnerPassword123!")

    operator_email = f"operator_{uuid.uuid4().hex[:8]}@test.com"
    operator_data = create_user(client, owner_token, "MES Operator", operator_email, "operator")
    operator_token = login_user(client, operator_email, operator_data["temp_password"])
    client.post(
        "/api/v1/auth/change-password",
        headers={"Authorization": f"Bearer {operator_token}"},
        json={"current_password": operator_data["temp_password"], "new_password": "OperatorPassword123!"},
    )
    operator_token = login_user(client, operator_email, "OperatorPassword123!")
    client.post("/api/v1/operator/toggle-duty", headers={"Authorization": f"Bearer {operator_token}"})

    machine = create_machine(client, owner_token, "CNC Lathe 01")
    return owner_token, operator_data["id"], machine["id"]


def prepare_locked_job(client, owner_token, operator_id, machine_id):
    client_response = client.post(
        "/api/v1/clients/",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "company_name": "Atlas Components",
            "contact_person": "Riya Shah",
            "email": f"client_{uuid.uuid4().hex[:8]}@test.com",
            "phone": "+919999999999",
            "address": "Plot 42, Industrial Estate",
            "send_email": False,
        },
    )
    assert client_response.status_code == 201
    client_user_id = client_response.json()["id"]

    task_response = client.post(
        "/api/v1/tasks/",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "title": "Drive Shaft Batch A",
            "priority": "high",
            "client_id": client_user_id,
            "machine_id": machine_id,
        },
    )
    assert task_response.status_code == 201
    task_id = task_response.json()["id"]

    cnc_response = client.patch(
        f"/api/v1/tasks/{task_id}/cnc-fields",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "part_name": "Drive Shaft Batch A",
            "material_type": "EN24",
            "material_batch": "BATCH-01",
            "drawing_url": "/uploads/drawing.png",
        },
    )
    assert cnc_response.status_code == 200

    early_execution = client.patch(
        f"/api/v1/tasks/{task_id}/status",
        headers={"Authorization": f"Bearer {owner_token}"},
        params={"new_status": "in_progress"},
    )
    assert early_execution.status_code == 400
    assert "locked before execution" in early_execution.text

    extract_response = client.post(
        f"/api/v1/job-specs/{task_id}/extract",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "part_name": "Drive Shaft Batch A",
            "drawing_context": "Overall length 250 mm, diameter 40 mm, Thread M20, keyway 8 mm, runout 0.02 mm",
        },
    )
    assert extract_response.status_code == 200

    confirm_response = client.post(
        f"/api/v1/job-specs/{task_id}/confirm-all",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert confirm_response.status_code == 200

    lock_response = client.post(
        f"/api/v1/tasks/{task_id}/lock",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert lock_response.status_code == 200
    assert lock_response.json()["status"] == "created"

    suggest_process = client.post(
        f"/api/v1/job-processes/{task_id}/suggest",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert suggest_process.status_code == 200

    lock_process = client.post(
        f"/api/v1/job-processes/{task_id}/lock",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert lock_process.status_code == 200
    assert lock_process.json()["status"] == "planned"

    return task_id, client_user_id


def test_supervisor_style_client_creation_and_lock_gate(client, platform_admin_token):
    owner_token, operator_id, machine_id = bootstrap_company(client, platform_admin_token)
    task_id, client_user_id = prepare_locked_job(client, owner_token, operator_id, machine_id)

    client_list = client.get("/api/v1/clients/", headers={"Authorization": f"Bearer {owner_token}"})
    assert client_list.status_code == 200
    assert any(item["id"] == client_user_id for item in client_list.json())

    material_ready = client.post(
        f"/api/v1/tasks/{task_id}/material-validation",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"material_type": "EN24", "material_batch": "BATCH-01"},
    )
    assert material_ready.status_code == 200
    assert material_ready.json()["task"]["status"] == "ready"

    assignment = client.post(
        f"/api/v1/tasks/{task_id}/mes-assign",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"assigned_to": operator_id, "machine_id": machine_id},
    )
    assert assignment.status_code == 200
    assert assignment.json()["task"]["status"] == "assigned"


def test_drawing_text_extraction_preserves_real_dimensions(client, platform_admin_token):
    owner_token, operator_id, machine_id = bootstrap_company(client, platform_admin_token)
    task_id, _ = prepare_locked_job(client, owner_token, operator_id, machine_id)

    specs_response = client.get(
        f"/api/v1/job-specs/{task_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert specs_response.status_code == 200

    specs_map = {
        item["field_name"]: item["human_value"] or item["ai_value"]
        for item in specs_response.json()["specs"]
    }

    assert specs_map["Overall_Length"] == "250"
    assert specs_map["Diameter_1_OD"] == "40"
    assert specs_map["Thread_Spec"] == "M20"
    assert specs_map["Keyway_Width"] == "8"
    assert specs_map["Runout_Tolerance"] == "0.02"


def test_strict_ocr_pipeline_normalizes_threads_and_validation_states():
    ocr_payload = _normalize_ocr_payload(
        {
            "raw_text": "Overall length 250 mm, Ø40, Thread M20, keyway width 8 mm, runout 0.02 mm",
            "dimensions": {
                "lengths_mm": [250],
                "diameters_mm": [40],
                "threads": [20],
            },
            "features": {
                "keyways": [{"width_mm": 8, "depth_mm": 4}],
            },
            "tolerances": {
                "runout_mm": 0.02,
            },
            "confidence": {
                "overall": 0.94,
                "comment": "clear drawing text",
            },
        }
    )

    specs, summary = _build_specs_from_ocr_payload(ocr_payload)
    specs_map = {item["field_name"]: item for item in specs}

    assert ocr_payload["dimensions"]["threads"] == ["M20"]
    assert specs_map["Overall_Length"]["ai_value"] == "250"
    assert specs_map["Diameter_1_OD"]["ai_value"] == "40"
    assert specs_map["Thread_Spec"]["ai_value"] == "M20"
    assert specs_map["Keyway_Width"]["ai_value"] == "8"
    assert specs_map["Runout_Tolerance"]["ai_value"] == "0.02"
    assert specs_map["Thread_Spec"]["review_status"] == "high_confidence"
    assert specs_map["Diameter_1_OD"]["review_status"] == "needs_review"
    assert summary["review_counts"]["invalid"] == 0


def test_invalid_specs_require_human_value_before_confirm_all(client, platform_admin_token):
    owner_token, operator_id, machine_id = bootstrap_company(client, platform_admin_token)
    task = create_task(client, owner_token, "Manual Review Gate", machine_id, operator_id)
    task_id = task["id"]

    add_response = client.post(
        f"/api/v1/job-specs/{task_id}/add",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={
            "field_name": "Diameter_1_OD",
            "ai_value": "999",
            "unit": "mm",
            "ai_confidence": 0.0,
        },
    )
    assert add_response.status_code == 201
    spec_id = add_response.json()["id"]

    confirm_response = client.post(
        f"/api/v1/job-specs/{task_id}/confirm-all",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert confirm_response.status_code == 400
    assert "typed human value" in confirm_response.text

    patch_response = client.patch(
        f"/api/v1/job-specs/spec/{spec_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"human_value": "40", "is_confirmed": True},
    )
    assert patch_response.status_code == 200

    confirm_response = client.post(
        f"/api/v1/job-specs/{task_id}/confirm-all",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert confirm_response.status_code == 200


def test_full_mes_flow_reaches_dispatch_and_completion(client, platform_admin_token, monkeypatch):
    owner_token, operator_id, machine_id = bootstrap_company(client, platform_admin_token)
    task_id, _ = prepare_locked_job(client, owner_token, operator_id, machine_id)

    monkeypatch.setattr(
        "app.api.v1.tasks.analyze_setup_image",
        lambda *_args, **_kwargs: {
            "status": "ok",
            "confidence": 0.93,
            "message": "Setup verified.",
            "suggestion": "Proceed.",
            "issues": [],
        },
    )
    monkeypatch.setattr(
        "app.api.v1.tasks.analyze_final_inspection",
        lambda *_args, **_kwargs: {
            "status": "ok",
            "confidence": 0.91,
            "message": "Part meets spec.",
            "suggestion": "Approve",
            "decision": "APPROVE",
            "defects": [],
        },
    )

    client.post(
        f"/api/v1/tasks/{task_id}/material-validation",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"material_type": "EN24", "material_batch": "BATCH-01"},
    )
    client.post(
        f"/api/v1/tasks/{task_id}/mes-assign",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"assigned_to": operator_id, "machine_id": machine_id},
    )

    setup_check = client.post(
        f"/api/v1/tasks/{task_id}/ai-setup-check",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert setup_check.status_code == 200
    assert setup_check.json()["task"]["status"] == "setup_done"

    first_piece = client.post(
        f"/api/v1/tasks/{task_id}/first-piece-review",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"qc_status": "pass", "measurements": {"length": "250 mm"}},
    )
    assert first_piece.status_code == 200
    assert first_piece.json()["task"]["status"] == "in_progress"

    production = client.post(
        f"/api/v1/tasks/{task_id}/production-log",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"produced_qty": 12, "rejected_qty": 1, "downtime_minutes": 8, "notes": "Minor offset correction"},
    )
    assert production.status_code == 201
    assert production.json()["totals"]["produced_qty"] == 12

    qc_report = client.post(
        f"/api/v1/tasks/{task_id}/qc-report",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"qc_status": "pass", "measurements": {"runout": "0.02 mm"}, "remarks": "Stable"},
    )
    assert qc_report.status_code == 201
    assert qc_report.json()["task"]["status"] == "in_progress"

    final_ai = client.post(
        f"/api/v1/tasks/{task_id}/ai-final-inspection",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert final_ai.status_code == 200
    assert final_ai.json()["task"]["status"] == "final_inspection"

    approve = client.post(
        f"/api/v1/tasks/{task_id}/supervisor-final-decision",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"decision": "approve", "remarks": "Approved for dispatch"},
    )
    assert approve.status_code == 200

    dispatch = client.post(
        f"/api/v1/tasks/{task_id}/dispatch",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"packing_details": "Rust preventive wrap", "invoice_number": "INV-1001", "transport_details": "BlueDart"},
    )
    assert dispatch.status_code == 200
    assert dispatch.json()["task"]["status"] == "dispatched"

    complete = client.patch(
        f"/api/v1/tasks/{task_id}/status",
        headers={"Authorization": f"Bearer {owner_token}"},
        params={"new_status": "completed"},
    )
    assert complete.status_code == 200
    assert complete.json()["status"] == "completed"

    summary = client.get(
        f"/api/v1/tasks/{task_id}/mes-summary",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert summary.status_code == 200
    assert summary.json()["production_totals"]["rejected_qty"] == 1
    assert summary.json()["dispatch"]["invoice_number"] == "INV-1001"


def test_rework_resets_flow_without_erasing_history(client, platform_admin_token, monkeypatch):
    owner_token, operator_id, machine_id = bootstrap_company(client, platform_admin_token)
    task_id, _ = prepare_locked_job(client, owner_token, operator_id, machine_id)

    monkeypatch.setattr(
        "app.api.v1.tasks.analyze_setup_image",
        lambda *_args, **_kwargs: {
            "status": "ok",
            "confidence": 0.95,
            "message": "Setup verified.",
            "suggestion": "Proceed.",
            "issues": [],
        },
    )
    monkeypatch.setattr(
        "app.api.v1.tasks.analyze_final_inspection",
        lambda *_args, **_kwargs: {
            "status": "issue",
            "confidence": 0.88,
            "message": "Surface roughness exceeds spec.",
            "suggestion": "Rework",
            "decision": "REWORK",
            "defects": ["Surface roughness exceeds spec."],
        },
    )

    client.post(
        f"/api/v1/tasks/{task_id}/material-validation",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"material_type": "EN24", "material_batch": "BATCH-01"},
    )
    client.post(
        f"/api/v1/tasks/{task_id}/mes-assign",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"assigned_to": operator_id, "machine_id": machine_id},
    )
    client.post(f"/api/v1/tasks/{task_id}/ai-setup-check", headers={"Authorization": f"Bearer {owner_token}"})
    client.post(
        f"/api/v1/tasks/{task_id}/first-piece-review",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"qc_status": "pass", "measurements": {"length": "250 mm"}},
    )
    client.post(
        f"/api/v1/tasks/{task_id}/ai-final-inspection",
        headers={"Authorization": f"Bearer {owner_token}"},
    )

    rework = client.post(
        f"/api/v1/tasks/{task_id}/supervisor-final-decision",
        headers={"Authorization": f"Bearer {owner_token}"},
        json={"decision": "rework", "remarks": "Surface issue"},
    )
    assert rework.status_code == 200
    assert rework.json()["task"]["rework_flag"] is True
    assert rework.json()["task"]["rework_iteration"] == 1
    assert rework.json()["task"]["status"] == "in_progress"

    summary = client.get(
        f"/api/v1/tasks/{task_id}/mes-summary",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert summary.status_code == 200
    assert len(summary.json()["rework_history"]) == 1

    operations = client.get(
        f"/api/v1/job-processes/{task_id}",
        headers={"Authorization": f"Bearer {owner_token}"},
    )
    assert operations.status_code == 200
    assert operations.json()["operations"]
    assert all(op["is_locked"] is False for op in operations.json()["operations"])
