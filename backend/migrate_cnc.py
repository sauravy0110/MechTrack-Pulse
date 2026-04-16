"""
migrate_cnc.py — CNC Shaft MES schema migration

Adds:
  1. CNC columns to the tasks table
     (is_locked, rework_flag, rework_iteration, drawing_url,
      material_type, material_batch, part_name, rework_reason)
  2. New table: job_specs   (AI-extracted drawing specifications)
  3. New table: job_processes (CNC operation steps / process plan)

Safe to re-run — every ALTER TABLE is wrapped in a try/except,
and CREATE TABLE uses IF NOT EXISTS.
"""

import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text
from app.db.database import engine


def migrate():
    print("=== CNC Shaft MES Migration ===\n")

    with engine.begin() as conn:

        # ── 1. CNC columns on tasks ──────────────────────────────
        print("→ Patching tasks table with CNC fields…")

        cnc_task_columns = [
            ("is_locked",         "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("rework_flag",       "BOOLEAN NOT NULL DEFAULT FALSE"),
            ("rework_iteration",  "INTEGER NOT NULL DEFAULT 0"),
            ("drawing_url",       "TEXT"),
            ("material_type",     "VARCHAR(200)"),
            ("material_batch",    "VARCHAR(200)"),
            ("part_name",         "VARCHAR(200)"),
            ("rework_reason",     "TEXT"),
        ]

        for col, definition in cnc_task_columns:
            try:
                conn.execute(text(f"ALTER TABLE tasks ADD COLUMN {col} {definition};"))
                print(f"   ✅ Added tasks.{col}")
            except Exception as e:
                print(f"   ⏩ tasks.{col} already exists ({type(e).__name__})")

        # ── 2. job_specs table ──────────────────────────────────
        print("\n→ Creating job_specs table…")
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS job_specs (
                    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    task_id       UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    field_name    VARCHAR(100) NOT NULL,
                    ai_value      VARCHAR(200),
                    ai_confidence FLOAT,
                    human_value   VARCHAR(200),
                    unit          VARCHAR(20) DEFAULT 'mm',
                    is_confirmed  BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at    TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """))
            print("   ✅ job_specs table created")
        except Exception as e:
            print(f"   ⚠️  job_specs: {e}")

        # Indexes for job_specs
        for idx_sql, idx_name in [
            ("CREATE INDEX IF NOT EXISTS ix_job_specs_task_id ON job_specs(task_id);", "ix_job_specs_task_id"),
            ("CREATE INDEX IF NOT EXISTS ix_job_specs_company_id ON job_specs(company_id);", "ix_job_specs_company_id"),
        ]:
            try:
                conn.execute(text(idx_sql))
                print(f"   ✅ Index {idx_name}")
            except Exception as e:
                print(f"   ⏩ Index {idx_name}: {e}")

        # ── 3. job_processes table ──────────────────────────────
        print("\n→ Creating job_processes table…")
        try:
            conn.execute(text("""
                CREATE TABLE IF NOT EXISTS job_processes (
                    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                    company_id           UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
                    task_id              UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
                    operation_name       VARCHAR(200) NOT NULL,
                    machine_id           UUID REFERENCES machines(id) ON DELETE SET NULL,
                    tool_required        VARCHAR(200),
                    cycle_time_minutes   INTEGER,
                    sequence_order       INTEGER NOT NULL DEFAULT 1,
                    notes                VARCHAR(500),
                    is_ai_suggested      BOOLEAN NOT NULL DEFAULT FALSE,
                    is_locked            BOOLEAN NOT NULL DEFAULT FALSE,
                    created_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
                    updated_at           TIMESTAMP WITH TIME ZONE DEFAULT NOW()
                );
            """))
            print("   ✅ job_processes table created")
        except Exception as e:
            print(f"   ⚠️  job_processes: {e}")

        # Indexes for job_processes
        for idx_sql, idx_name in [
            ("CREATE INDEX IF NOT EXISTS ix_job_processes_task_id ON job_processes(task_id);", "ix_job_processes_task_id"),
            ("CREATE INDEX IF NOT EXISTS ix_job_processes_company_id ON job_processes(company_id);", "ix_job_processes_company_id"),
        ]:
            try:
                conn.execute(text(idx_sql))
                print(f"   ✅ Index {idx_name}")
            except Exception as e:
                print(f"   ⏩ Index {idx_name}: {e}")

        print("\n=== Migration complete ✅ ===")


if __name__ == "__main__":
    migrate()
