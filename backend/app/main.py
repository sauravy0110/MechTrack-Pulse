"""
MechTrack Pulse — Application Entry Point

Run with: uvicorn app.main:app --reload
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.api.router import api_router
from app.core.config import get_settings
from app.db.database import Base, engine
from app.middleware.tenant import (
    ErrorHandlerMiddleware,
    RequestLoggingMiddleware,
    SecurityHeadersMiddleware,
)
from app.core.logger import setup_logging
from app.core.rate_limit import limiter
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from prometheus_fastapi_instrumentator import Instrumentator
from app.core.observability import setup_tracing

settings = get_settings()

# Initialize structured logging
setup_logging()

# Initialize OpenTelemetry Tracing (Distributed Tracing)
if settings.ENVIRONMENT != "testing":
    setup_tracing(app=None, engine=engine) # App instrumented below after factory creation


# ── Startup Migrations ───────────────────────────────────────
# Safely add columns that create_all() can't add to existing tables.
_COLUMN_MIGRATIONS = [
    # (table, column, SQL type)
    ("tasks", "deleted_at", "TIMESTAMPTZ"),
    ("tasks", "operation_type", "VARCHAR(100)"),
    ("tasks", "operation_other", "VARCHAR(255)"),
    ("users", "duty_expires_at", "TIMESTAMPTZ"),
    ("users", "owner_feedback_score", "DOUBLE PRECISION DEFAULT 3.0"),
    ("users", "operator_feedback_score", "DOUBLE PRECISION DEFAULT 3.0"),
    ("tasks", "submitted_for_review_at", "TIMESTAMPTZ"),
    ("tasks", "reviewed_by", "UUID"),
    ("tasks", "review_status", "VARCHAR(20)"),
    ("tasks", "review_comment", "TEXT"),
]


def _run_column_migrations(bind):
    """Add missing columns to existing tables (idempotent)."""
    with bind.connect() as conn:
        for table, column, col_type in _COLUMN_MIGRATIONS:
            try:
                conn.execute(
                    text(
                        f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS "
                        f"{column} {col_type}"
                    )
                )
                conn.commit()
            except Exception as exc:
                print(f"⚠️  Migration {table}.{column}: {exc}")
                conn.rollback()


def _run_review_table_migrations(bind):
    with bind.connect() as conn:
        try:
            conn.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS job_reviews (
                        id UUID PRIMARY KEY,
                        company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                        job_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                        reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
                        decision VARCHAR(20) NOT NULL,
                        comment TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_job_reviews_company_id ON job_reviews(company_id)"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_job_reviews_job_id ON job_reviews(job_id)"))
            conn.commit()
        except Exception as exc:
            print(f"⚠️  Review table migration failed: {exc}")
            conn.rollback()


# ── Lifecycle ────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: Create tables (dev only). Shutdown: Cleanup."""
    import app.models  # noqa: F401

    # Ensure tables exist
    try:
        Base.metadata.create_all(bind=engine)
        print(f"✅ {settings.APP_NAME} — Tables verified/created")
    except Exception as e:
        print(f"⚠️  {settings.APP_NAME} — DB not available: {e}")
        print("   Server will start, but DB operations will fail.")

    # Run column migrations for existing tables
    try:
        _run_column_migrations(engine)
        print(f"✅ {settings.APP_NAME} — Column migrations applied")
    except Exception as e:
        print(f"⚠️  Column migrations failed: {e}")

    try:
        _run_review_table_migrations(engine)
        print(f"✅ {settings.APP_NAME} — Review table migrations applied")
    except Exception as e:
        print(f"⚠️  Review table migrations failed: {e}")

    # Seed platform admin
    try:
        from app.db.database import SessionLocal
        from app.services.auth_service import seed_platform_admin

        db = SessionLocal()
        seed_platform_admin(db)
        db.close()
    except Exception as e:
        print(f"⚠️  Could not seed admin: {e}")

    yield
    print(f"🛑 {settings.APP_NAME} — Shutting down")


# ── App Factory ──────────────────────────────────────────────
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Multi-tenant factory control system with AI & 3D visualization",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
)

# ── Metrics ──────────────────────────────────────────────────
Instrumentator().instrument(app).expose(app)

# ── Tracing ──────────────────────────────────────────────────
if settings.ENVIRONMENT != "testing":
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
        FastAPIInstrumentor.instrument_app(app)
    except ImportError:
        pass

# ── Rate Limiting ────────────────────────────────────────────
if settings.ENVIRONMENT != "testing":
    app.state.limiter = limiter
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ── Middleware (order matters: last added = first executed) ──
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(RequestLoggingMiddleware)
app.add_middleware(ErrorHandlerMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:4173",
        "https://mech-track-pulse.vercel.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Static Files (uploaded images) ───────────────────────────
import os
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# ── Routes ───────────────────────────────────────────────────
@app.get("/", tags=["System"])
def root():
    """Root endpoint for status verification."""
    return {"message": f"{settings.APP_NAME} API is running 🚀", "version": settings.APP_VERSION}

app.include_router(api_router, prefix="/api/v1")


# ── Health Check ─────────────────────────────────────────────
@app.get("/health", tags=["System"])
def health_check():
    """Health endpoint for monitoring & load balancers."""
    return {
        "status": "healthy",
        "app": settings.APP_NAME,
        "version": settings.APP_VERSION,
    }
