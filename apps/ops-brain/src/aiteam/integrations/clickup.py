"""ClickUp bidirectional sync for Ops Brain.

Talks to the BLAIQ daemon's /api/v1/org/clickup/* endpoints (registered
in apps/daemon/src/integrations/clickup-routes.ts) which in turn call the
Composio CLICKUP toolkit. The daemon owns the Composio credentials so
Ops Brain never sees the OAuth token directly.

Two flows:

* ``on_task_create_hook(repository, task)`` — called after a row is
  inserted into ``ops.tasks``. Pushes the task to ClickUp and stamps
  the returned external id on the local row so future polls can match.
* ``poll_clickup(tenant_id, repository)`` — periodic worker that pulls
  recent ClickUp tasks and upserts them into ``ops.tasks`` keyed by
  ``(tenant_id, external_id)``.

Status mapping (ClickUp → ops.tasks):

============  =================
ClickUp       ops.tasks
============  =================
open          pending
in progress   running
closed        completed
============  =================
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import os
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

import httpx
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from aiteam.storage.connection import get_session
from aiteam.storage.models import TaskModel
from aiteam.types import Task, TaskPriority, TaskHorizon, TaskStatus

logger = logging.getLogger(__name__)

EXTERNAL_SOURCE = "clickup"
_DEFAULT_DAEMON_URL = "http://127.0.0.1:8765"
_DEFAULT_POLL_INTERVAL_S = 300.0
_REQUEST_TIMEOUT_S = 30.0

_STATUS_FROM_CLICKUP: dict[str, TaskStatus] = {
    "open": TaskStatus.PENDING,
    "to do": TaskStatus.PENDING,
    "todo": TaskStatus.PENDING,
    "pending": TaskStatus.PENDING,
    "in progress": TaskStatus.RUNNING,
    "in_progress": TaskStatus.RUNNING,
    "running": TaskStatus.RUNNING,
    "closed": TaskStatus.COMPLETED,
    "complete": TaskStatus.COMPLETED,
    "completed": TaskStatus.COMPLETED,
    "done": TaskStatus.COMPLETED,
}

_STATUS_TO_CLICKUP: dict[TaskStatus, str] = {
    TaskStatus.PENDING: "open",
    TaskStatus.RUNNING: "in progress",
    TaskStatus.COMPLETED: "closed",
}


def map_clickup_status(value: str | None) -> TaskStatus:
    if not value:
        return TaskStatus.PENDING
    return _STATUS_FROM_CLICKUP.get(value.strip().lower(), TaskStatus.PENDING)


def map_status_to_clickup(value: TaskStatus) -> str:
    return _STATUS_TO_CLICKUP.get(value, "open")


@dataclass(frozen=True)
class DaemonEndpoint:
    """Per-tenant daemon endpoint used by both the hook and the poller."""

    base_url: str
    tenant_id: str
    user_id: str = ""

    @classmethod
    def from_env(cls, tenant_id: str, user_id: str = "") -> DaemonEndpoint:
        return cls(
            base_url=os.environ.get("BLAIQ_DAEMON_URL", _DEFAULT_DAEMON_URL).rstrip("/"),
            tenant_id=tenant_id,
            user_id=user_id,
        )

    def headers(self) -> dict[str, str]:
        ts = str(int(time.time() * 1000))
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-Tenant-Id": self.tenant_id,
            "X-User-Id": self.user_id,
            "X-Ops-Trust-Ts": ts,
        }
        trust_token = os.environ.get("OPS_BRAIN_TRUST_TOKEN", "").strip()
        if trust_token:
            sig = hmac.new(
                trust_token.encode("utf-8"),
                f"{self.tenant_id}:{ts}".encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            headers["X-Ops-Trust"] = sig
        return headers


async def _post_json(endpoint: DaemonEndpoint, path: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    url = f"{endpoint.base_url}{path}"
    try:
        async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_S) as client:
            resp = await client.post(url, json=payload, headers=endpoint.headers())
    except httpx.HTTPError as exc:
        logger.warning("clickup %s transport failure: %s", path, exc)
        return None
    if resp.status_code >= 400:
        logger.warning("clickup %s -> HTTP %s: %s", path, resp.status_code, resp.text[:200])
        return None
    try:
        return resp.json()
    except ValueError:
        logger.warning("clickup %s returned non-JSON body", path)
        return None


# ---------------------------------------------------------------------------
# Hook: push newly-inserted ops.tasks rows to ClickUp.
# ---------------------------------------------------------------------------


async def on_task_create_hook(
    task: Task,
    *,
    tenant_id: str,
    list_id: str,
    user_id: str = "",
) -> str | None:
    """Push a freshly-created Task to ClickUp.

    Returns the ClickUp external id on success and ``None`` if the call
    failed. On success the helper stamps ``external_id`` /
    ``external_source`` on the local ops.tasks row.
    """
    endpoint = DaemonEndpoint.from_env(tenant_id, user_id=user_id)
    payload: dict[str, Any] = {
        "list_id": list_id,
        "name": task.title,
        "description": task.description or "",
    }
    if task.assigned_to:
        payload["assignees"] = [task.assigned_to]

    response = await _post_json(endpoint, "/api/v1/org/clickup/task", payload)
    if not response or not response.get("ok"):
        return None
    external_id = response.get("external_id")
    if not isinstance(external_id, str) or not external_id:
        return None

    async with get_session() as session:
        await session.execute(
            TaskModel.__table__
            .update()
            .where(TaskModel.id == task.id)
            .where(TaskModel.tenant_id == tenant_id)
            .values(external_id=external_id, external_source=EXTERNAL_SOURCE)
        )
    return external_id


# ---------------------------------------------------------------------------
# Poller: pull recent ClickUp tasks → upsert into ops.tasks.
# ---------------------------------------------------------------------------


def _coerce_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    return str(value)


def _coerce_status_dict(raw: Any) -> str | None:
    if isinstance(raw, dict):
        return _coerce_text(raw.get("status")) or None
    if isinstance(raw, str):
        return raw
    return None


async def _upsert_clickup_task(
    session: AsyncSession,
    tenant_id: str,
    payload: dict[str, Any],
) -> None:
    external_id = _coerce_text(payload.get("id"))
    if not external_id:
        return
    title = _coerce_text(payload.get("name")) or "(untitled ClickUp task)"
    description = _coerce_text(payload.get("text_content") or payload.get("description") or "")
    status = map_clickup_status(_coerce_status_dict(payload.get("status")))
    now = datetime.now(timezone.utc)

    existing = await session.execute(
        select(TaskModel.id).where(
            TaskModel.tenant_id == tenant_id,
            TaskModel.external_id == external_id,
            TaskModel.external_source == EXTERNAL_SOURCE,
        )
    )
    found = existing.scalar_one_or_none()
    if found:
        await session.execute(
            TaskModel.__table__
            .update()
            .where(TaskModel.id == found)
            .where(TaskModel.tenant_id == tenant_id)
            .values(
                title=title,
                description=description,
                status=status.value,
                completed_at=now if status == TaskStatus.COMPLETED else None,
            )
        )
        return

    new_id = str(uuid.uuid4())
    stmt = pg_insert(TaskModel.__table__).values(
        id=new_id,
        tenant_id=tenant_id,
        team_id=None,
        title=title,
        description=description,
        status=status.value,
        assigned_to=None,
        result=None,
        parent_id=None,
        project_id=None,
        depends_on=[],
        depth=0,
        order=0,
        template_id=None,
        priority=TaskPriority.MEDIUM.value,
        horizon=TaskHorizon.SHORT.value,
        tags=[],
        config={},
        external_id=external_id,
        external_source=EXTERNAL_SOURCE,
        created_at=now,
        started_at=None,
        completed_at=now if status == TaskStatus.COMPLETED else None,
    )
    await session.execute(stmt)


async def sync_once(tenant_id: str, *, user_id: str = "") -> int:
    """One-shot sync. Returns number of tasks upserted (0 on failure)."""
    endpoint = DaemonEndpoint.from_env(tenant_id, user_id=user_id)
    response = await _post_json(endpoint, "/api/v1/org/clickup/sync", {})
    if not response or not response.get("ok"):
        return 0
    tasks = response.get("tasks")
    if not isinstance(tasks, list):
        return 0

    upserted = 0
    async with get_session() as session:
        for entry in tasks:
            if not isinstance(entry, dict):
                continue
            try:
                await _upsert_clickup_task(session, tenant_id, entry)
                upserted += 1
            except Exception:
                logger.exception("clickup upsert failed for tenant=%s", tenant_id)
    return upserted


async def _clickup_enabled(tenant_id: str) -> bool:
    """Read tenant_brand.clickup_enabled (RLS-bound). False until the PM turns
    ClickUp sync on in the admin Settings, so the poller stays a no-op."""
    try:
        async with get_session() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT clickup_enabled FROM tenant_brand "
                        "WHERE tenant_id = CAST(:tid AS uuid)"
                    ),
                    {"tid": tenant_id},
                )
            ).first()
        return bool(row[0]) if row else False
    except Exception:
        logger.debug("clickup_enabled check failed (tenant=%s)", tenant_id, exc_info=True)
        return False


async def poll_clickup(
    tenant_id: str,
    *,
    interval_s: float = _DEFAULT_POLL_INTERVAL_S,
    user_id: str = "",
) -> None:
    """Long-running poller for a single tenant.

    Hosted by the Track D tenant scheduler (see aiteam.api.deps). The
    coroutine never returns under normal conditions; cancel the task to
    stop it during tenant eviction. Each tick is skipped while the tenant
    has ClickUp disabled, so it idles cheaply until configured.
    """
    logger.info("ClickUp poller started: tenant=%s every %.0fs", tenant_id, interval_s)
    announced_disabled = False
    while True:
        try:
            if not await _clickup_enabled(tenant_id):
                if not announced_disabled:
                    logger.info(
                        "ClickUp sync disabled for tenant=%s; idling until enabled in Settings",
                        tenant_id,
                    )
                    announced_disabled = True
            else:
                announced_disabled = False
                count = await sync_once(tenant_id, user_id=user_id)
                if count:
                    logger.info("ClickUp poller upserted %d tasks for tenant=%s", count, tenant_id)
        except asyncio.CancelledError:
            logger.info("ClickUp poller cancelled: tenant=%s", tenant_id)
            raise
        except Exception:
            logger.exception("ClickUp poll failed for tenant=%s", tenant_id)
        try:
            await asyncio.sleep(interval_s)
        except asyncio.CancelledError:
            logger.info("ClickUp poller cancelled during sleep: tenant=%s", tenant_id)
            raise
