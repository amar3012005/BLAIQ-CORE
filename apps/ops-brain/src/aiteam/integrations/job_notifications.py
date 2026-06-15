"""Job notifications (Track A6).

A pluggable notifier: records every notification to ``ops.notifications`` and,
when a real channel is configured (future: SMTP / Protonet), attempts to send
and marks the row ``sent``/``failed``. Until then notifications are ``logged``
so delivery notices and payment reminders are fully auditable with no external
provider — which keeps the workflow testable end-to-end.
"""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import text

from aiteam.storage.connection import current_tenant_id, get_session

logger = logging.getLogger(__name__)


async def record_notification(
    tenant_id: str,
    *,
    kind: str,
    subject: str,
    body: str = "",
    job_id: str | None = None,
    channel: str = "log",
) -> str:
    """Persist (and, when configured, send) a notification. Returns status.

    Caller may already hold the tenant ContextVar; we set it explicitly so the
    RLS INSERT works whether called from a request or a background task.
    """
    # Placeholder for a real channel — wire SMTP/Protonet here later and set
    # status="sent" on success. For now every notification is recorded "logged".
    status = "logged"
    token = current_tenant_id.set(tenant_id)
    try:
        async with get_session() as session:
            await session.execute(
                text(
                    "INSERT INTO ops.notifications "
                    "(tenant_id, job_id, kind, channel, subject, body, status) "
                    "VALUES (CAST(:tid AS uuid), CAST(:job_id AS uuid), :kind, :channel, "
                    ":subject, :body, :status)"
                ),
                {
                    "tid": tenant_id,
                    "job_id": job_id,
                    "kind": kind,
                    "channel": channel,
                    "subject": subject,
                    "body": body,
                    "status": status,
                },
            )
    finally:
        current_tenant_id.reset(token)
    logger.info(
        "notification recorded: kind=%s status=%s job=%s tenant=%s",
        kind, status, job_id, tenant_id,
    )
    return status


async def list_job_notifications(tenant_id: str, job_id: str) -> list[dict[str, Any]]:
    """Return notifications for a job, newest first (RLS-scoped)."""
    token = current_tenant_id.set(tenant_id)
    try:
        async with get_session() as session:
            rows = (
                await session.execute(
                    text(
                        "SELECT id, kind, channel, subject, body, status, created_at "
                        "FROM ops.notifications WHERE job_id = CAST(:job_id AS uuid) "
                        "ORDER BY created_at DESC LIMIT 100"
                    ),
                    {"job_id": job_id},
                )
            ).all()
    finally:
        current_tenant_id.reset(token)
    return [
        {
            "id": int(r[0]),
            "kind": r[1],
            "channel": r[2],
            "subject": r[3],
            "body": r[4],
            "status": r[5],
            "created_at": r[6].isoformat() if r[6] else None,
        }
        for r in rows
    ]
