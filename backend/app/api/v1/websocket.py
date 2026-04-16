"""
MechTrack Pulse — WebSocket Endpoint

Real-time updates per tenant (company_id).
Broadcasts: task updates, notifications.

USAGE:
  ws://localhost:8000/api/v1/ws/{company_id}?token=<JWT>
"""

from uuid import UUID
import asyncio
import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from redis.asyncio import Redis
from redis.exceptions import RedisError

from app.core.security import decode_token
from app.core.config import get_settings

settings = get_settings()

router = APIRouter()


# ── Connection Manager ───────────────────────────────────────

class ConnectionManager:
    """
    Manages WebSocket connections per company (tenant rooms).
    Key: company_id → list of WebSocket connections.
    """

    def __init__(self):
        self.rooms: dict[str, list[WebSocket]] = {}
        self._redis = None
        self._pubsub = None
        self._listener_task = None
        self._redis_loop = None

    @property
    def redis(self):
        import asyncio
        loop = asyncio.get_running_loop()
        if self._redis is None or self._redis_loop != loop:
            self._redis = Redis.from_url(settings.REDIS_URL, decode_responses=True)
            self._pubsub = self._redis.pubsub()
            self._redis_loop = loop
            self._listener_task = None
        return self._redis

    async def start_listener(self):
        # Ensure redis is initialized
        try:
            _ = self.redis
            if self._listener_task is None or self._listener_task.done():
                self._listener_task = asyncio.create_task(self._listen_to_redis())
        except RedisError:
            self._listener_task = None

    async def _listen_to_redis(self):
        try:
            await self._pubsub.psubscribe("room:*")
            async for message in self._pubsub.listen():
                if message["type"] == "pmessage":
                    channel = message["channel"]
                    company_id = channel.split(":")[1]
                    data = json.loads(message["data"])
                    await self._send_to_local(company_id, data)
        except RedisError:
            self._listener_task = None

    async def connect(self, websocket: WebSocket, company_id: str):
        await websocket.accept()
        if company_id not in self.rooms:
            self.rooms[company_id] = []
        self.rooms[company_id].append(websocket)
        await self.start_listener()

    def disconnect(self, websocket: WebSocket, company_id: str):
        if company_id in self.rooms:
            self.rooms[company_id] = [
                ws for ws in self.rooms[company_id] if ws != websocket
            ]
            if not self.rooms[company_id]:
                del self.rooms[company_id]

    async def broadcast(self, company_id: str, message: dict):
        """Publish to Redis instead of only local loop."""
        from fastapi.encoders import jsonable_encoder
        json_message = jsonable_encoder(message)
        try:
            await self.redis.publish(f"room:{company_id}", json.dumps(json_message))
        except RedisError:
            await self._send_to_local(company_id, json_message)

    async def _send_to_local(self, company_id: str, message: dict):
        """Called by listener when a Redis message arrives cleanly."""
        if company_id not in self.rooms:
            return
        disconnected = []
        for ws in self.rooms[company_id]:
            try:
                await ws.send_json(message)
            except Exception:
                disconnected.append(ws)
        for ws in disconnected:
            self.disconnect(ws, company_id)

    def get_connection_count(self, company_id: str) -> int:
        return len(self.rooms.get(company_id, []))


# Global manager instance
manager = ConnectionManager()


# ── WebSocket Endpoint ───────────────────────────────────────

@router.websocket("/ws/{company_id}")
async def websocket_endpoint(
    websocket: WebSocket,
    company_id: str,
    token: str = Query(...),
):
    """
    WebSocket endpoint with JWT authentication.
    Validates token and ensures user belongs to the company.
    """
    # Validate JWT token
    payload = decode_token(token)
    if not payload:
        await websocket.close(code=4001, reason="Invalid token")
        return

    token_company = payload.get("company_id")
    if token_company != company_id:
        await websocket.close(code=4003, reason="Company mismatch")
        return

    await manager.connect(websocket, company_id)
    try:
        while True:
            # Keep connection alive, receive any client messages
            data = await websocket.receive_json()
            # Echo back for now (clients can send pings)
            await websocket.send_json({"type": "ack", "data": data})
    except WebSocketDisconnect:
        manager.disconnect(websocket, company_id)


# ── Broadcast Helper (used by other services) ───────────────

async def broadcast_task_update(company_id: UUID, task_data: dict):
    """Broadcast a task update to all connected users in the company."""
    await manager.broadcast(str(company_id), {
        "type": "task_update",
        "data": task_data,
    })


async def broadcast_notification(company_id: UUID, message: str, severity: str = "info"):
    """Broadcast a notification to all connected users in the company."""
    await manager.broadcast(str(company_id), {
        "type": "notification",
        "message": message,
        "severity": severity,
    })


async def broadcast_operator_update(company_id: UUID, operator_data: dict):
    """Broadcast an operator duty/status change to all connected users."""
    await manager.broadcast(str(company_id), {
        "type": "operator_update",
        "data": operator_data,
    })


async def broadcast_machine_update(company_id: UUID, machine_data: dict):
    """Broadcast a machine update to all connected users in the company."""
    await manager.broadcast(str(company_id), {
        "type": "machine_update",
        "data": machine_data,
    })


async def broadcast_user_update(company_id: UUID, user_data: dict):
    """Broadcast a user creation/update event to all connected users in the company."""
    await manager.broadcast(str(company_id), {
        "type": "user_update",
        "data": user_data,
    })


async def broadcast_task_deleted(company_id: UUID, task_id: str):
    """Broadcast a task deletion event to all connected users in the company."""
    await manager.broadcast(str(company_id), {
        "type": "task_deleted",
        "data": {"id": task_id},
    })
