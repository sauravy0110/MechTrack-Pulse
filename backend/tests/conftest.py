import os
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

# Set test environment
os.environ["DATABASE_URL"] = "postgresql+psycopg://postgres:postgres@localhost:5432/mechtrack_test"
os.environ["SECRET_KEY"] = "testsecret"
os.environ["JWT_SECRET_KEY"] = "testsecret"
os.environ["ENVIRONMENT"] = "testing"

from app.main import app
from app.db.database import Base, get_db
from app.services.auth_service import seed_platform_admin

# Test database setup
TEST_SQLALCHEMY_DATABASE_URL = "postgresql+psycopg://postgres:postgres@localhost:5432/mechtrack_test"

engine = create_engine(
    TEST_SQLALCHEMY_DATABASE_URL,
    pool_pre_ping=True
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    """Create and seed the test database."""
    # Drop all and recreate
    Base.metadata.drop_all(bind=engine)
    with engine.begin() as conn:
        conn.execute(text("DROP TYPE IF EXISTS status_enum CASCADE;"))
        conn.execute(text("DROP TYPE IF EXISTS priority_enum CASCADE;"))
        conn.execute(text("DROP TYPE IF EXISTS role_enum CASCADE;"))
    Base.metadata.create_all(bind=engine)
    
    # Seed platform admin
    db = TestingSessionLocal()
    seed_platform_admin(db)
    db.close()
    yield
    # Optional: cleanup after all tests
    # Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db():
    """Get a fresh DB session for each test."""
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    
    yield session
    
    session.close()
    transaction.rollback()
    connection.close()

@pytest.fixture
def client(db):
    """Get a TestClient instance with DB dependency override."""
    def override_get_db():
        try:
            yield db
        finally:
            pass
            
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.pop(get_db, None)

@pytest.fixture
def platform_admin_token(client):
    """Get an access token for the platform admin."""
    res = client.post("/api/v1/platform/login", json={
        "email": "admin@mechtrackpulse.com",
        "password": "Admin@12345"
    })
    return res.json()["access_token"]
