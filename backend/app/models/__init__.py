"""
MechTrack Pulse — Models Package

Imports all models so Base.metadata knows about every table.
Add every new model here as you create it.
"""

from app.models.company import Company
from app.models.subscription import Subscription
from app.models.user import User
from app.models.platform_admin import PlatformAdmin
from app.models.audit_log import AuditLog
from app.models.ai_action_log import AIActionLog
from app.models.task import Task
from app.models.task_log import TaskLog
from app.models.task_image import TaskImage
from app.models.machine import Machine
from app.models.client import Client
from app.models.job_version import JobVersion
from app.models.assignment import Assignment
from app.models.production_log import ProductionLog
from app.models.qc_report import QCReport
from app.models.ai_report import AIReport
from app.models.rework_log import ReworkLog
from app.models.dispatch_record import DispatchRecord
from app.models.operator_score import OperatorScore
from app.models.ai_insight import AIInsight
from app.models.report import Report
from app.models.job_spec import JobSpec
from app.models.job_process import JobProcess
from app.models.job_review import JobReview

__all__ = [
    "Company",
    "Subscription",
    "User",
    "PlatformAdmin",
    "AuditLog",
    "Task",
    "TaskLog",
    "TaskImage",
    "Machine",
    "Client",
    "JobVersion",
    "Assignment",
    "ProductionLog",
    "QCReport",
    "AIReport",
    "ReworkLog",
    "DispatchRecord",
    "OperatorScore",
    "AIInsight",
    "Report",
    "JobSpec",
    "JobProcess",
    "JobReview",
]
