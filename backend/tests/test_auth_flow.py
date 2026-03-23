import pytest
from tests.utils import register_company, approve_company, login_user

def test_login_flow(client, platform_admin_token):
    """Test the login and token generation flow."""
    # Setup company and owner
    email = "auth_owner@test.com"
    company_id = register_company(client, email=email)
    temp_password = approve_company(client, platform_admin_token, company_id, email=email)
    
    # 1. Login
    res = client.post("/api/v1/auth/login", json={
        "email": "auth_owner@test.com",
        "password": temp_password
    })
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["token_type"] == "bearer"

def test_refresh_token_flow(client, platform_admin_token):
    """Test the refresh token flow."""
    # Setup company and owner
    email = "refresh_owner@test.com"
    company_id = register_company(client, email=email)
    temp_password = approve_company(client, platform_admin_token, company_id, email=email)
    
    # Login
    res = client.post("/api/v1/auth/login", json={
        "email": "refresh_owner@test.com",
        "password": temp_password
    })
    refresh_token = res.json()["refresh_token"]
    
    # Refresh
    res = client.post("/api/v1/auth/refresh", json={
        "refresh_token": refresh_token
    })
    assert res.status_code == 200
    new_data = res.json()
    assert "access_token" in new_data
    assert "refresh_token" in new_data

def test_invalid_login_fails(client):
    """Test login with incorrect credentials."""
    res = client.post("/api/v1/auth/login", json={
        "email": "nonexistent@test.com",
        "password": "wrongpassword"
    })
    assert res.status_code == 401
