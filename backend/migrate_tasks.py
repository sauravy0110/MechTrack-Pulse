import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.db.database import engine

def migrate():
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN total_time_spent_seconds INTEGER DEFAULT 0 NOT NULL;"))
            print("Added total_time_spent_seconds")
        except Exception as e:
            print("Error total_time_spent_seconds:", e)
            
        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN timer_started_at TIMESTAMP WITH TIME ZONE;"))
            print("Added timer_started_at")
        except Exception as e:
            print("Error timer_started_at:", e)
            
        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN delay_reason TEXT;"))
            print("Added delay_reason")
        except Exception as e:
            print("Error delay_reason:", e)

if __name__ == "__main__":
    migrate()
