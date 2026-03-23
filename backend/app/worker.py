"""
MechTrack Pulse — Celery Worker Configuration

WHY: While FastAPI BackgroundTasks are great for fire-and-forget logic
in the same process, Celery is required for heavy operations (PDF gen, bulk emails)
that could block the async event loop or need retry/persistence guarantees.
"""

from celery import Celery
from app.core.config import get_settings

settings = get_settings()

celery_app = Celery(
    "mechtrack_worker",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
)

@celery_app.task(name="heavy_report_generation")
def heavy_report_generation(report_id: str, company_id: str):
    """
    Placeholder for a heavy task to demonstrate Celery functionality.
    """
    import time
    from app.core.logger import logger
    
    logger.info("Starting heavy report generation", report_id=report_id)
    time.sleep(3)  # simulate heavy CPU work
    logger.info("Report generation complete", report_id=report_id)
    
    return {"status": "success", "report_url": f"/reports/{company_id}/{report_id}.pdf"}
