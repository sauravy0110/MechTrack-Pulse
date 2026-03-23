"""
MechTrack Pulse — Global Error Handling & Logging Middleware

Catches unhandled exceptions and returns clean JSON responses.
Adds request logging for observability.
"""

import time
import traceback
from uuid import uuid4

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.logger import logger


class ErrorHandlerMiddleware(BaseHTTPMiddleware):
    """
    Catches all unhandled exceptions and returns a 500 JSON response.
    Prevents stack traces from leaking to clients.
    """

    async def dispatch(self, request: Request, call_next):
        try:
            response = await call_next(request)
            return response
        except Exception as exc:
            error_id = str(uuid4())[:8]
            logger.error(
                "unhandled_exception",
                error_id=error_id,
                error=str(exc),
                path=f"{request.method} {request.url.path}",
                trace=traceback.format_exc()
            )
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal server error",
                    "error_id": error_id,
                },
            )


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """
    Logs every request with method, path, status, and duration.
    """

    async def dispatch(self, request: Request, call_next):
        start = time.time()
        response = await call_next(request)
        duration = (time.time() - start) * 1000  # ms

        # Skip health checks and static assets from logging
        path = request.url.path
        if path not in ("/health", "/metrics", "/docs", "/openapi.json"):
            logger.info(
                "request_completed",
                method=request.method,
                path=path,
                status_code=response.status_code,
                duration_ms=round(duration, 2),
            )

        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """
    Adds security headers to all responses.
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response
