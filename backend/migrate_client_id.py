import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.db.database import engine

def migrate():
    with engine.begin() as conn:
        try:
            conn.execute(text("ALTER TABLE tasks ADD COLUMN client_id UUID REFERENCES users(id) ON DELETE SET NULL;"))
            print("Added client_id to tasks")
        except Exception as e:
            print("Error client_id:", e)

if __name__ == "__main__":
    migrate()
