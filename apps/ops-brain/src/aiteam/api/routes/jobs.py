"""BLAIQ Admin — Job lifecycle routes.

A Job is the central entity of the BLAIQ project workflow:

  Client inquiry → PM creates Job+JobNumber in POOOL
      ├─ POOOL track:    quote → costs → invoice → payment
      ├─ ClickUp track:  folder → ticket → assign → revisions
      └─ Server track:   folder → creative files → delivery

Jobs are stored in ops.jobs (tenant-scoped, like all other ops.* tables).
The ClickUp folder/ticket IDs are stamped here once created so the admin
can navigate directly.  Finance fields mirror what POOOL would report;
they are updated either via webhook or manual PM update.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from typing import Any, Literal

from collections.abc import AsyncGenerator

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import Date, DateTime, String, Text, select
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Mapped, mapped_column

from aiteam.api.schemas import APIListResponse, APIResponse
from aiteam.storage.connection import current_tenant_id, get_session
from aiteam.storage.models import Base

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


async def _get_db() -> AsyncGenerator[AsyncSession, None]:
    """FastAPI dependency that yields a tenant-scoped AsyncSession.

    Also materializes the tenant's service graph (idempotent + cached) so the
    POOOL sync + ClickUp pollers start the first time the admin touches the
    jobs API. Activation failures are non-fatal — jobs CRUD still works.
    """
    tid = current_tenant_id.get("")
    if tid:
        try:
            from aiteam.api.deps import get_tenant_state

            await get_tenant_state(tid)
        except Exception:  # noqa: BLE001 - activation is best-effort
            logger.warning("tenant activation failed (tenant=%s)", tid, exc_info=True)
    async with get_session() as session:
        yield session

OPS_SCHEMA = "ops"

# ──────────────────────────────────────────────
# Domain literals
# ──────────────────────────────────────────────

PooolStatus = Literal[
    "quote_pending",
    "quote_sent",
    "quote_approved",
    "invoiced",
    "partially_paid",
    "paid",
    "overdue",
]

DeliveryStatus = Literal["in_progress", "delivered", "archived"]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ──────────────────────────────────────────────
# SQLAlchemy model
# ──────────────────────────────────────────────

class JobModel(Base):
    """ops.jobs — BLAIQ project job registry (tri-track)."""

    __tablename__ = "jobs"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)

    # Core identity
    job_number: Mapped[str] = mapped_column(String(64), nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    client: Mapped[str] = mapped_column(Text, nullable=False, default="")

    # POOOL track
    poool_status: Mapped[str] = mapped_column(String(32), nullable=False, default="quote_pending")
    poool_job_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    quote_amount: Mapped[float | None] = mapped_column(nullable=True)
    third_party_costs: Mapped[float | None] = mapped_column(nullable=True)
    # Itemised third-party costs: [{"vendor": str, "amount": float}, ...].
    # third_party_costs mirrors the sum of these so existing readers keep working.
    cost_items: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    invoice_amount: Mapped[float | None] = mapped_column(nullable=True)
    payment_due_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # ClickUp track
    clickup_folder_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    clickup_ticket_ids: Mapped[list[Any]] = mapped_column(JSONB, nullable=False, default=list)
    revision_count: Mapped[int] = mapped_column(nullable=False, default=0)

    # Server track
    server_folder_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    delivery_status: Mapped[str] = mapped_column(String(32), nullable=False, default="in_progress")
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Metadata
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


# ──────────────────────────────────────────────
# Pydantic schemas
# ──────────────────────────────────────────────

class CostItem(BaseModel):
    """A single third-party cost line (e.g. a vendor invoice the agency
    passes through to the client)."""

    vendor: str = ""
    amount: float = 0.0


class Job(BaseModel):
    id: str
    job_number: str
    title: str
    client: str
    poool_status: str
    poool_job_id: str | None = None
    quote_amount: float | None = None
    third_party_costs: float | None = None
    cost_items: list[CostItem] = Field(default_factory=list)
    invoice_amount: float | None = None
    payment_due_date: str | None = None
    clickup_folder_id: str | None = None
    clickup_ticket_ids: list[str] = Field(default_factory=list)
    revision_count: int = 0
    server_folder_path: str | None = None
    delivery_status: str
    delivered_at: str | None = None
    notes: str = ""
    created_at: str
    updated_at: str


class JobCreate(BaseModel):
    job_number: str
    title: str
    client: str = ""
    poool_job_id: str | None = None
    quote_amount: float | None = None
    notes: str = ""


class JobUpdate(BaseModel):
    title: str | None = None
    client: str | None = None
    poool_status: str | None = None
    poool_job_id: str | None = None
    quote_amount: float | None = None
    third_party_costs: float | None = None
    cost_items: list[CostItem] | None = None
    invoice_amount: float | None = None
    payment_due_date: str | None = None
    clickup_folder_id: str | None = None
    clickup_ticket_ids: list[str] | None = None
    revision_count: int | None = None
    server_folder_path: str | None = None
    delivery_status: str | None = None
    notes: str | None = None


def _to_pydantic(m: JobModel) -> Job:
    return Job(
        id=m.id,
        job_number=m.job_number,
        title=m.title,
        client=m.client,
        poool_status=m.poool_status,
        poool_job_id=m.poool_job_id,
        quote_amount=m.quote_amount,
        third_party_costs=m.third_party_costs,
        cost_items=[CostItem(**c) for c in (m.cost_items or []) if isinstance(c, dict)],
        invoice_amount=m.invoice_amount,
        payment_due_date=m.payment_due_date.isoformat() if m.payment_due_date else None,
        clickup_folder_id=m.clickup_folder_id,
        clickup_ticket_ids=list(m.clickup_ticket_ids or []),
        revision_count=m.revision_count,
        server_folder_path=m.server_folder_path,
        delivery_status=m.delivery_status,
        delivered_at=m.delivered_at.isoformat() if m.delivered_at else None,
        notes=m.notes,
        created_at=m.created_at.isoformat(),
        updated_at=m.updated_at.isoformat(),
    )


# ──────────────────────────────────────────────
# Routes
# ──────────────────────────────────────────────

@router.post("", response_model=APIResponse[Job], status_code=201)
async def create_job(
    body: JobCreate,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[Job]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")

    job = JobModel(
        id=str(uuid.uuid4()),
        tenant_id=tenant_id,
        job_number=body.job_number,
        title=body.title,
        client=body.client,
        poool_job_id=body.poool_job_id,
        quote_amount=body.quote_amount,
        notes=body.notes,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)

    # Auto-create the delivery folder (Track A5). Best-effort — a folder-server
    # hiccup must never fail job creation.
    try:
        from aiteam.integrations.serverfiles import create_job_folder

        res = await create_job_folder(tenant_id, client=job.client, job_number=job.job_number)
        if res.get("ok") and res.get("path"):
            job.server_folder_path = str(res["path"])
            await db.commit()
            await db.refresh(job)
    except Exception:
        logger.warning("auto server-folder create failed (job=%s)", job.id, exc_info=True)

    return APIResponse(data=_to_pydantic(job), message="Job created")


@router.get("", response_model=APIListResponse[Job])
async def list_jobs(
    db: AsyncSession = Depends(_get_db),
) -> APIListResponse[Job]:
    tenant_id = current_tenant_id.get("")
    result = await db.execute(
        select(JobModel)
        .where(JobModel.tenant_id == tenant_id)
        .order_by(JobModel.created_at.desc())
    )
    jobs = [_to_pydantic(m) for m in result.scalars().all()]
    return APIListResponse(data=jobs, total=len(jobs))


@router.get("/{job_id}", response_model=APIResponse[Job])
async def get_job(
    job_id: str,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[Job]:
    tenant_id = current_tenant_id.get("")
    result = await db.execute(
        select(JobModel).where(
            JobModel.id == job_id,
            JobModel.tenant_id == tenant_id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return APIResponse(data=_to_pydantic(job))


@router.patch("/{job_id}", response_model=APIResponse[Job])
async def update_job(
    job_id: str,
    body: JobUpdate,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[Job]:
    tenant_id = current_tenant_id.get("")
    result = await db.execute(
        select(JobModel).where(
            JobModel.id == job_id,
            JobModel.tenant_id == tenant_id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    prev_revision = job.revision_count
    prev_delivery = job.delivery_status
    updates = body.model_dump(exclude_none=True)

    # cost_items is the source of truth for the third-party total: whenever the
    # PM edits the line items we recompute third_party_costs so finance views
    # and the +15% production fee stay consistent.
    if "cost_items" in updates:
        items = updates["cost_items"]
        updates["third_party_costs"] = round(
            sum(float(c.get("amount") or 0) for c in items), 2
        )

    # payment_due_date arrives as an ISO date string ("YYYY-MM-DD"); coerce it
    # to a date so the Date column accepts it.
    if "payment_due_date" in updates and isinstance(updates["payment_due_date"], str):
        raw = updates["payment_due_date"].strip()
        updates["payment_due_date"] = date.fromisoformat(raw[:10]) if raw else None

    for field, value in updates.items():
        setattr(job, field, value)

    if body.delivery_status == "delivered" and not job.delivered_at:
        job.delivered_at = _utcnow()

    job.updated_at = _utcnow()
    await db.commit()
    await db.refresh(job)

    # Auto-ticket per revision round (Track A4): each new revision opens a
    # "Korrektur N" ticket in ClickUp. Best-effort — never blocks the update,
    # and is a clean no-op when ClickUp isn't enabled/connected.
    if job.revision_count > prev_revision:
        try:
            from aiteam.integrations.clickup import create_ticket_for_job

            res = await create_ticket_for_job(
                tenant_id,
                title=f"Korrektur {job.revision_count} · {job.job_number} {job.title}",
                description=f"Revision round {job.revision_count} for job {job.job_number}.",
            )
            if res.get("ok") and res.get("ticket_id"):
                tickets = list(job.clickup_ticket_ids or [])
                tickets.append(res["ticket_id"])
                job.clickup_ticket_ids = tickets
                await db.commit()
                await db.refresh(job)
        except Exception:
            logger.warning("auto-ticket on revision failed (job=%s)", job_id, exc_info=True)

    # Delivery notification (Track A6): when a job first becomes delivered,
    # notify the client. Best-effort; recorded to ops.notifications.
    if job.delivery_status == "delivered" and prev_delivery != "delivered":
        try:
            from aiteam.integrations.job_notifications import record_notification

            await record_notification(
                tenant_id,
                kind="delivery",
                job_id=job.id,
                subject=f"Lieferung — {job.job_number} {job.title}",
                body=f"The layout for job {job.job_number} ({job.client}) has been delivered.",
            )
        except Exception:
            logger.warning("delivery notification failed (job=%s)", job_id, exc_info=True)

    return APIResponse(data=_to_pydantic(job), message="Job updated")


@router.delete("/{job_id}", response_model=APIResponse[None])
async def delete_job(
    job_id: str,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[None]:
    tenant_id = current_tenant_id.get("")
    result = await db.execute(
        select(JobModel).where(
            JobModel.id == job_id,
            JobModel.tenant_id == tenant_id,
        )
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    await db.delete(job)
    await db.commit()
    return APIResponse(data=None, message="Job deleted")


# ──────────────────────────────────────────────
# POOOL write actions (Track A3)
# ──────────────────────────────────────────────

@router.post("/{job_id}/push-poool", response_model=APIResponse[Job])
async def push_to_poool(
    job_id: str,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[Job]:
    """Create a POOOL project + quote for this job and stamp poool_job_id.

    Credential-ready: if POOOL isn't enabled/configured the call returns 503
    with a human-readable detail (the UI surfaces it) and the job is unchanged.
    """
    tenant_id = current_tenant_id.get("")
    result = await db.execute(
        select(JobModel).where(JobModel.id == job_id, JobModel.tenant_id == tenant_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    from aiteam.integrations.poool import create_poool_quote

    res = await create_poool_quote(
        tenant_id,
        project_name=f"{job.job_number} · {job.title}",
        amount=job.quote_amount,
        client_name=job.client,
    )
    if not res.get("ok") or not res.get("poool_job_id"):
        raise HTTPException(status_code=503, detail=res.get("error") or "POOOL unavailable")

    job.poool_job_id = str(res["poool_job_id"])
    if job.poool_status == "quote_pending":
        job.poool_status = "quote_sent"
    job.updated_at = _utcnow()
    await db.commit()
    await db.refresh(job)
    return APIResponse(data=_to_pydantic(job), message="Pushed to POOOL")


# ──────────────────────────────────────────────
# ClickUp write actions (Track A4)
# ──────────────────────────────────────────────

@router.post("/{job_id}/push-clickup", response_model=APIResponse[Job])
async def push_to_clickup(
    job_id: str,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[Job]:
    """Create a ClickUp ticket for this job and append its id to the job.

    Credential-ready: returns 503 with a clear detail when ClickUp isn't
    enabled/connected, leaving the job unchanged.
    """
    tenant_id = current_tenant_id.get("")
    result = await db.execute(
        select(JobModel).where(JobModel.id == job_id, JobModel.tenant_id == tenant_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    from aiteam.integrations.clickup import create_ticket_for_job

    res = await create_ticket_for_job(
        tenant_id,
        title=f"{job.job_number} · {job.title}",
        description=job.notes or "",
    )
    if not res.get("ok") or not res.get("ticket_id"):
        raise HTTPException(status_code=503, detail=res.get("error") or "ClickUp unavailable")

    tickets = list(job.clickup_ticket_ids or [])
    tickets.append(str(res["ticket_id"]))
    job.clickup_ticket_ids = tickets
    job.updated_at = _utcnow()
    await db.commit()
    await db.refresh(job)
    return APIResponse(data=_to_pydantic(job), message="Pushed to ClickUp")


# ──────────────────────────────────────────────
# Server folder automation (Track A5)
# ──────────────────────────────────────────────

@router.post("/{job_id}/server-folder", response_model=APIResponse[Job])
async def create_server_folder(
    job_id: str,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[Job]:
    """Create (or re-create) the job's delivery folder and stamp the path."""
    tenant_id = current_tenant_id.get("")
    result = await db.execute(
        select(JobModel).where(JobModel.id == job_id, JobModel.tenant_id == tenant_id)
    )
    job = result.scalar_one_or_none()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    from aiteam.integrations.serverfiles import create_job_folder

    res = await create_job_folder(tenant_id, client=job.client, job_number=job.job_number)
    if not res.get("ok") or not res.get("path"):
        raise HTTPException(status_code=503, detail=res.get("error") or "server folder unavailable")

    job.server_folder_path = str(res["path"])
    job.updated_at = _utcnow()
    await db.commit()
    await db.refresh(job)
    return APIResponse(data=_to_pydantic(job), message="Server folder created")


# ──────────────────────────────────────────────
# Notifications (Track A6)
# ──────────────────────────────────────────────

class Notification(BaseModel):
    id: int
    kind: str
    channel: str
    subject: str
    body: str
    status: str
    created_at: str | None = None


@router.get("/{job_id}/notifications", response_model=APIListResponse[Notification])
async def list_notifications(
    job_id: str,
    db: AsyncSession = Depends(_get_db),
) -> APIListResponse[Notification]:
    tenant_id = current_tenant_id.get("")
    from aiteam.integrations.job_notifications import list_job_notifications

    rows = await list_job_notifications(tenant_id, job_id)
    items = [Notification(**r) for r in rows]
    return APIListResponse(data=items, total=len(items))
