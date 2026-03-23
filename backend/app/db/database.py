"""
MechTrack Pulse — Database Engine & Session

WHY separate file:
- Engine created once at startup (connection pool)
- SessionLocal is a factory — each request gets its own session
- Base is the declarative base for all ORM models
- get_db is a FastAPI dependency that auto-closes sessions

IMPORTANT: We use TIMESTAMPTZ (timezone-aware) everywhere.
"""

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.core.config import get_settings

settings = get_settings()

# ── Engine ───────────────────────────────────────────────────
# pool_pre_ping=True → tests connections before using them
# This prevents "connection closed" errors after DB restarts.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    echo=settings.DEBUG,    # Log SQL in debug mode
)

# ── Session Factory ──────────────────────────────────────────
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)


# ── Declarative Base ─────────────────────────────────────────
class Base(DeclarativeBase):
    """Base class for all SQLAlchemy ORM models."""
    pass


# ── Dependency ───────────────────────────────────────────────
def get_db():
    """
    FastAPI dependency that yields a DB session.
    Session is automatically closed after the request.

    Usage in routes:
        @router.get("/example")
        def example(db: Session = Depends(get_db)):
            ...
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
