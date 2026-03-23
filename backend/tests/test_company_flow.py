import pytest
from tests.utils import register_company, approve_company, login_user

def test_company_registration_and_approval(client, platform_admin_token):
    """Test the full company registration and platform admin approval flow."""
    # 1. Register Company
    email = "owner@e2e.com"
    company_id = register_company(client, name="E2E Corp", email=email)
    assert company_id is not None
    
    # 2. Approve Company
    temp_password = approve_company(client, platform_admin_token, company_id, email=email)
    assert temp_password is not None
    
    # 3. Initial Login with Temp Password
    owner_token = login_user(client, "owner@e2e.com", temp_password)
    assert owner_token is not None
    
    # 4. Password Change Flow
    res = client.post("/api/v1/auth/change-password", headers={
        "Authorization": f"Bearer {owner_token}"
    }, json={
        "current_password": temp_password,
        "new_password": "SecurePassword123!"
    })
    assert res.status_code == 200
    
    # 5. Relogin with new password
    new_token = login_user(client, "owner@e2e.com", "SecurePassword123!")
    assert new_token is not None

def test_duplicate_company_registration_fails(client):
    """Edge Case: Test that duplicate company registration (email) is rejected."""
    register_company(client, name="First Corp", email="duplicate@test.com")
    
    res = client.post("/api/v1/companies/register", json={
        "company_name": "Second Corp",
        "gst_number": "22AAAAA1111A1Z5",
        "msme_number": "UDYAM-MH-00-1111111",
        "industry_type": "Manufacturing",
        "address": "123 Industrial Rd",
        "city": "Mumbai",
        "state": "MH",
        "owner_name": "Test Owner",
        "owner_email": "duplicate@test.com",
        "owner_phone": "+919876543210"
    })
    assert res.status_code == 400
    assert "Email already registered" in res.text
