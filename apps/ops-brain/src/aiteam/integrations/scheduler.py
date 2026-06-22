"""Content scheduling/automation — recurring on-brand content.

A per-tenant background loop checks ``ops.content_schedules`` for due entries
and generates a brand-locked social draft for each, storing it in
``ops.content_runs`` for review (one-click post links included). Hosted by the
tenant scheduler in ``aiteam.api.deps`` alongside the POOOL/ClickUp pollers.
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from aiteam.storage.connection import get_session

logger = logging.getLogger("aiteam.scheduler")

# cadence → SQL interval literal (never interpolate user text; mapped here).
_CADENCE_INTERVAL = {"daily": "1 day", "weekly": "7 days"}


async def _run_schedule(session: AsyncSession, tenant_id: str, row) -> str | None:
    """Generate one draft for a schedule row and persist it. Returns run id."""
    # Lazy import avoids a heavy import at module load + any cycle.
    from aiteam.api.routes.copilot import generate_social_artifact

    art = await generate_social_artifact(session, tenant_id, row.platform, row.topic, row.lang or None)
    run_id = str(uuid.uuid4())
    await session.execute(
        text(
            "INSERT INTO ops.content_runs (id, tenant_id, schedule_id, platform, title, body, hashtags, share_url) "
            "VALUES (CAST(:id AS uuid), CAST(:t AS uuid), CAST(:sid AS uuid), :p, :ti, :b, CAST(:h AS jsonb), :u)"
        ),
        {
            "id": run_id, "t": tenant_id, "sid": str(row.id), "p": art.platform,
            "ti": art.title, "b": art.body, "h": json.dumps(art.hashtags), "u": art.share_url,
        },
    )
    interval = _CADENCE_INTERVAL.get(row.cadence, "7 days")
    await session.execute(
        text(
            f"UPDATE ops.content_schedules SET last_run_at = NOW(), "
            f"next_run_at = NOW() + INTERVAL '{interval}', runs = runs + 1 "
            f"WHERE id = CAST(:id AS uuid)"
        ),
        {"id": str(row.id)},
    )
    await session.commit()
    return run_id


async def run_due_schedules(tenant_id: str) -> int:
    """Run every due, enabled schedule for the tenant. Returns count produced."""
    produced = 0
    async with get_session() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT id, platform, topic, lang, cadence FROM ops.content_schedules "
                    "WHERE enabled = true AND next_run_at <= NOW() ORDER BY next_run_at LIMIT 20"
                )
            )
        ).all()
        for row in rows:
            try:
                await _run_schedule(session, tenant_id, row)
                produced += 1
            except Exception:  # noqa: BLE001
                logger.exception("content schedule %s failed (tenant=%s)", row.id, tenant_id)
                await session.rollback()
    return produced


async def run_schedule_now(session: AsyncSession, tenant_id: str, schedule_id: str) -> str | None:
    """Fire a schedule immediately (manual trigger). Returns the new run id."""
    row = (
        await session.execute(
            text(
                "SELECT id, platform, topic, lang, cadence FROM ops.content_schedules "
                "WHERE id = CAST(:id AS uuid) LIMIT 1"
            ),
            {"id": schedule_id},
        )
    ).first()
    if not row:
        return None
    return await _run_schedule(session, tenant_id, row)


async def poll_content_schedules(tenant_id: str, *, interval_s: float = 300.0) -> None:
    """Per-tenant content-schedule runner loop. Quiet until schedules exist."""
    logger.info("Content scheduler started: tenant=%s every %.0fs", tenant_id, interval_s)
    while True:
        try:
            n = await run_due_schedules(tenant_id)
            if n:
                logger.info("Content scheduler produced %d draft(s) (tenant=%s)", n, tenant_id)
        except asyncio.CancelledError:
            logger.info("Content scheduler cancelled: tenant=%s", tenant_id)
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Content scheduler tick failed for tenant=%s", tenant_id)
        try:
            await asyncio.sleep(interval_s)
        except asyncio.CancelledError:
            raise
