"""
MechTrack Pulse — API Router Aggregator

Combines all v1 routers into a single router for main.py.
"""

from fastapi import APIRouter

from app.api.v1.auth import router as auth_router
from app.api.v1.platform import router as platform_router
from app.api.v1.companies import router as companies_router
from app.api.v1.users import router as users_router
from app.api.v1.tasks import router as tasks_router
from app.api.v1.machines import router as machines_router
from app.api.v1.uploads import router as uploads_router
from app.api.v1.ai import router as ai_router
from app.api.v1.reports import router as reports_router
from app.api.v1.analytics import router as analytics_router
from app.api.v1.websocket import router as ws_router
from app.api.v1.operators import router as operators_router
from app.api.v1.supervisor import router as supervisor_router
from app.api.v1.owner import router as owner_router
from app.api.v1.client import router as client_router
from app.api.v1.job_specs import router as job_specs_router
from app.api.v1.job_processes import router as job_processes_router

api_router = APIRouter()

# ── Register all routers ─────────────────────────────────────
api_router.include_router(auth_router, prefix="/auth", tags=["Auth"])
api_router.include_router(platform_router, prefix="/platform", tags=["Platform"])
api_router.include_router(companies_router, prefix="/companies", tags=["Companies"])
api_router.include_router(users_router, prefix="/users", tags=["Users"])
api_router.include_router(tasks_router, prefix="/tasks", tags=["Tasks"])
api_router.include_router(machines_router, prefix="/machines", tags=["Machines"])
api_router.include_router(uploads_router, prefix="/uploads", tags=["Uploads"])
api_router.include_router(ai_router, prefix="/ai", tags=["AI"])
api_router.include_router(reports_router, prefix="/reports", tags=["Reports"])
api_router.include_router(analytics_router, prefix="/analytics", tags=["Analytics"])
api_router.include_router(operators_router, prefix="/operator", tags=["Operators"])
api_router.include_router(supervisor_router, prefix="/supervisor", tags=["Supervisor"])
api_router.include_router(owner_router, prefix="/owner", tags=["Owner"])
api_router.include_router(client_router, prefix="/client", tags=["Client"])
api_router.include_router(job_specs_router, prefix="/job-specs", tags=["CNC Job Specs"])
api_router.include_router(job_processes_router, prefix="/job-processes", tags=["CNC Process Plan"])
api_router.include_router(ws_router, tags=["WebSocket"])

