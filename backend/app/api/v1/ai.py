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
from sqlalchemy.orm import Session

from app.core.dependencies import require_roles, require_password_changed
from app.db.database import get_db
from app.models.ai_insight import AIInsight
from app.models.user import User
from app.services.ai_service import (
    calculate_operator_performance,
    generate_insights,
    predict_delay,
)

router = APIRouter()


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

@router.get("/machine-risks")
def get_machine_risks(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles("owner", "supervisor", "operator", "client")),
):
    """Get aggregated risk scores for all machines for 3D UI highlights."""
    from app.services.ai_service import calculate_machine_risks
    return calculate_machine_risks(db, current_user.company_id)
