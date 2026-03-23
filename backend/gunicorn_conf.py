"""
Gunicorn configuration for production scaling.
Run with: gunicorn -c gunicorn_conf.py app.main:app
"""
import multiprocessing
import os

bind = os.getenv("BIND", "0.0.0.0:8000")
workers = int(os.getenv("WORKERS", multiprocessing.cpu_count() * 2 + 1))
worker_class = "uvicorn.workers.UvicornWorker"
loglevel = os.getenv("LOG_LEVEL", "info")
keepalive = 5
timeout = 120
graceful_timeout = 120
