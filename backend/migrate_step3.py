import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app.db.database import Base, engine
import app.models.shift
import app.models.alert_config

def migrate():
    print("Creating new tables...")
    Base.metadata.create_all(bind=engine)
    print("Tables created successfully.")

if __name__ == "__main__":
    migrate()
