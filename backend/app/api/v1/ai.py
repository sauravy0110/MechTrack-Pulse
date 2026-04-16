"""
MechTrack Pulse — AI API Routes

Endpoints:
  POST /api/v1/ai/predict-delay/{task_id}     → Predict delay for a task
  GET  /api/v1/ai/performance/{user_id}       → Get operator performance score
  POST /api/v1/ai/insights                    → Generate AI insights
  GET  /api/v1/ai/insights                    → List AI insights
"""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles, require_password_changed
from app.db.database import get_db
from app.models.ai_insight import AIInsight
from app.models.task import Task
from app.models.user import User
from app.services.ai_service import (
    answer_company_question,
    calculate_operator_performance,
    generate_instruction_draft,
    generate_insights,
    get_client_progress_summary,
    get_owner_intelligence,
    get_supervisor_intelligence,
    get_task_assistant,
    predict_delay,
)
from app.services.openrouter_service import get_openrouter_status
from app.services.task_service import user_can_access_task

router = APIRouter()


class GenerateInstructionsRequest(BaseModel):
    title: str = Field(..., min_length=2, max_length=255)
    description: str | None = None
    machine_name: str | None = Field(None, max_length=255)
    priority: str = Field("medium", pattern="^(low|medium|high|critical)$")


class AssistantQuestionRequest(BaseModel):
    question: str = Field(..., min_length=3, max_length=1000)


def _get_scoped_task_or_404(
    db: Session,
    current_user: User,
    task_id: UUID,
) -> Task:
    task = db.query(Task).filter(
        Task.id == task_id,
        Task.company_id == current_user.company_id,
    ).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if not user_can_access_task(task, current_user):
        raise HTTPException(status_code=403, detail="You do not have access to this task")
    return task


@router.post("/predict-delay/{task_id}")
def predict_task_delay(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Run delay prediction for a specific task."""
    result = predict_delay(db, current_user.company_id, task_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.get("/performance/{user_id}")
def get_performance_score(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Calculate and return performance score for an operator."""
    result = calculate_operator_performance(db, current_user.company_id, user_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.post("/insights")
def run_insights(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Generate AI insights for the company."""
    insights = generate_insights(db, current_user.company_id)
    return {"insights_generated": len(insights), "insights": insights}


@router.get("/insights")
def list_insights(
    unread_only: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """List AI insights for the company."""
    query = db.query(AIInsight).filter(
        AIInsight.company_id == current_user.company_id
    )
    if unread_only:
        query = query.filter(AIInsight.is_read == False)

    insights = query.order_by(AIInsight.created_at.desc()).limit(50).all()

    return [
        {
            "id": str(i.id),
            "type": i.insight_type,
            "message": i.message,
            "severity": i.severity,
            "is_read": i.is_read,
            "related_task": str(i.related_task) if i.related_task else None,
            "related_user": str(i.related_user) if i.related_user else None,
            "created_at": str(i.created_at),
        }
        for i in insights
    ]


@router.patch("/insights/{insight_id}/read")
def mark_insight_read(
    insight_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Mark an insight as read."""
    insight = db.query(AIInsight).filter(
        AIInsight.id == insight_id,
        AIInsight.company_id == current_user.company_id,
    ).first()
    if not insight:
        raise HTTPException(status_code=404, detail="Insight not found")

    insight.is_read = True
    db.commit()
    return {"message": "Insight marked as read"}


@router.get("/task-assistant/{task_id}")
def get_task_assistant_route(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Operator-friendly task guidance and execution coaching."""
    _get_scoped_task_or_404(db, current_user, task_id)
    result = get_task_assistant(db, current_user.company_id, task_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.post("/generate-instructions")
def generate_instructions_route(
    request: GenerateInstructionsRequest,
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Generate a structured instruction draft for new or existing tasks."""
    return generate_instruction_draft(
        request.title,
        machine_name=request.machine_name,
        priority=request.priority,
        description=request.description,
    )


@router.get("/supervisor-intelligence")
def get_supervisor_intelligence_route(
    task_id: UUID | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor")),
):
    """Control-room intelligence for live monitoring, assignment, and delay risk."""
    if task_id:
        _get_scoped_task_or_404(db, current_user, task_id)
    return get_supervisor_intelligence(db, current_user.company_id, task_id=task_id)


@router.get("/owner-intelligence")
def get_owner_intelligence_route(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner")),
):
    """Business-facing predictive analytics and optimization guidance."""
    return get_owner_intelligence(db, current_user.company_id)


@router.get("/client-summary/{task_id}")
def get_client_summary_route(
    task_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Client-friendly progress explanation for a single job."""
    task = _get_scoped_task_or_404(db, current_user, task_id)
    if current_user.role == "client":
        result = get_client_progress_summary(db, current_user.company_id, task_id, current_user.id)
    else:
        if not task.client_id:
            raise HTTPException(status_code=400, detail="Task is not linked to a client")
        result = get_client_progress_summary(db, current_user.company_id, task_id, task.client_id)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.post("/assistant")
def ask_global_assistant(
    request: AssistantQuestionRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_password_changed),
):
    """Global AI assistant for answering operations and business questions."""
    return answer_company_question(db, current_user.company_id, request.question)


@router.get("/provider-status")
def get_ai_provider_status(
    current_user: User = Depends(require_password_changed),
):
    """Expose whether OpenRouter is configured and which models are pinned."""
    status = get_openrouter_status()
    return {
        "enabled": status.get("enabled", False),
        "configured": status.get("configured", False),
        "vision_enabled": status.get("vision_enabled", False),
        "base_url": status.get("base_url"),
        "models": status.get("models", {}),
        "error": status.get("error"),
    }


@router.get("/machine-risks")
def get_machine_risks(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor", "operator", "client")),
):
    """Get aggregated risk scores for all machines for 3D UI highlights."""
    from app.services.ai_service import calculate_machine_risks
    return calculate_machine_risks(db, current_user.company_id)
