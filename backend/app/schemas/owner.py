"""
MechTrack Pulse — Owner Schemas
"""

from pydantic import BaseModel

class KPIDashboardResponse(BaseModel):
    total_tasks: int
    completed_tasks: int
    delayed_tasks: int
    in_progress_tasks: int
    
    productivity_percent: float
    delay_percent: float
    
    total_machines: int
    active_machines: int
    
    active_operators: int
