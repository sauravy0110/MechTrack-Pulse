import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.db.database import engine

def migrate():
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN is_on_duty BOOLEAN DEFAULT FALSE NOT NULL;"))
            print("Added is_on_duty")
        except Exception as e:
            print("Error is_on_duty:", e)
            
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN current_task_count INTEGER DEFAULT 0 NOT NULL;"))
            print("Added current_task_count")
        except Exception as e:
            print("Error current_task_count:", e)
            
        try:
            conn.execute(text("ALTER TABLE users ADD COLUMN last_active_at TIMESTAMP WITH TIME ZONE;"))
            print("Added last_active_at")
        except Exception as e:
            print("Error last_active_at:", e)

if __name__ == "__main__":
    migrate()
