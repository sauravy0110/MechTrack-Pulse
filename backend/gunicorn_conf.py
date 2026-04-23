"""
Gunicorn configuration for production scaling.
Run with: gunicorn -c gunicorn_conf.py app.main:app

Environment variables (set in Render dashboard or .env):
  PORT            — TCP port to bind (Render injects this, defaults to 10000)
  WEB_CONCURRENCY — Number of workers (Render sets this to 1 on free tier)
  WORKERS         — Override worker count manually
  BIND            — Full bind address override (e.g. unix:/tmp/gunicorn.sock)
  LOG_LEVEL       — Gunicorn log level (default: info)
"""
import multiprocessing
import os

# ── Port & Bind ──────────────────────────────────────────────
# Render injects $PORT (usually 10000). Fall back to 8000 locally.
port = os.getenv("PORT", "8000")
bind = os.getenv("BIND", f"0.0.0.0:{port}")

# ── Workers ──────────────────────────────────────────────────
# Priority: WORKERS env > WEB_CONCURRENCY env (set by Render) > cpu formula.
# On Render free tier WEB_CONCURRENCY=1 — respect it to avoid OOM.
_default_workers = multiprocessing.cpu_count() * 2 + 1
workers = int(
    os.getenv("WORKERS")
    or os.getenv("WEB_CONCURRENCY")
    or _default_workers
)

# ── Worker class ─────────────────────────────────────────────
worker_class = "uvicorn.workers.UvicornWorker"

# ── Timeouts & Logging ───────────────────────────────────────
loglevel       = os.getenv("LOG_LEVEL", "info")
keepalive      = 5
timeout        = 120
graceful_timeout = 120
