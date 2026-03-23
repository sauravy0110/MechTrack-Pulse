"""
MechTrack Pulse — Task Queue (DSA: Queue-Based Assignment)

Uses a FIFO queue to track unassigned tasks per company.
When an operator becomes free, the next task is dequeued.

WHY a queue:
- Fair ordering: first-created → first-assigned
- O(1) enqueue/dequeue via collections.deque
- In-memory for speed, rebuilt on startup from DB
"""

from collections import deque
from uuid import UUID

# Company-scoped task queues: {company_id: deque[task_id]}
_queues: dict[UUID, deque] = {}


def enqueue_task(company_id: UUID, task_id: UUID) -> None:
    """Add an unassigned task to the company's queue."""
    if company_id not in _queues:
        _queues[company_id] = deque()
    _queues[company_id].append(task_id)


def dequeue_task(company_id: UUID) -> UUID | None:
    """Get the next unassigned task from the company's queue."""
    if company_id not in _queues or not _queues[company_id]:
        return None
    return _queues[company_id].popleft()


def peek_queue(company_id: UUID) -> list[UUID]:
    """View all tasks in the queue without removing them."""
    if company_id not in _queues:
        return []
    return list(_queues[company_id])


def remove_from_queue(company_id: UUID, task_id: UUID) -> bool:
    """Remove a specific task from the queue (e.g., when manually assigned)."""
    if company_id not in _queues:
        return False
    try:
        _queues[company_id].remove(task_id)
        return True
    except ValueError:
        return False


def queue_size(company_id: UUID) -> int:
    """Get number of tasks waiting in queue."""
    if company_id not in _queues:
        return 0
    return len(_queues[company_id])
