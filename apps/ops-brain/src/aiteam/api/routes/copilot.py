"""Admin Copilot (Track AA, phase AA1).

A chat endpoint grounded in the tenant's live jobs. The dataset is small (a
handful of jobs per tenant), so rather than tool-calling we load the jobs +
a computed finance summary straight into the system prompt and let the model
answer. Read-only: no mutations here — agentic actions land in AA2.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from aiteam.api.schemas import APIResponse
from aiteam.integrations.llm import chat, copilot_model
from aiteam.storage.connection import current_tenant_id, get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/copilot", tags=["copilot"])


async def _get_db() -> AsyncGenerator[AsyncSession, None]:
    async with get_session() as session:
        yield session


class CopilotMessage(BaseModel):
    role: str
    content: str


class CopilotRequest(BaseModel):
    message: str
    history: list[CopilotMessage] = Field(default_factory=list)


class CopilotResponse(BaseModel):
    answer: str
    model: str


_SYSTEM = """You are the BLAIQ Admin Copilot for the creative agency B&B Markenagentur.
You help the project manager run the agency's jobs across three tracks: POOOL (finance),
ClickUp (tasks), and the delivery Server (files).

Rules:
- Answer ONLY from the JOB DATA provided below. Never invent jobs, numbers, or clients.
- Always cite the job number (e.g. 2026-014) when referring to a job.
- Be concise and practical. Money is in EUR. Today's date is given below.
- "overdue" = poool_status is invoiced/partially_paid and payment_due_date is in the past.
- "margin" for a job ≈ invoice (or quote) minus third_party_costs.
- If asked to DO something (create/update/send), explain you can't act yet (read-only),
  and tell the PM which button to use. Do not claim you performed an action.
"""


def _fmt_eur(v: float | None) -> str:
    if v is None:
        return "—"
    return f"€{v:,.0f}"


async def _build_job_context(db: AsyncSession, tenant_id: str) -> str:
    rows = (
        await db.execute(
            text(
                "SELECT job_number, title, client, poool_status, quote_amount, "
                "invoice_amount, third_party_costs, payment_due_date, delivery_status, "
                "revision_count, COALESCE(jsonb_array_length(clickup_ticket_ids),0), "
                "server_folder_path, notes "
                "FROM ops.jobs WHERE tenant_id = CAST(:tid AS uuid) "
                "ORDER BY created_at DESC"
            ),
            {"tid": tenant_id},
        )
    ).all()

    today = date.today()
    lines: list[str] = []
    total_quote = total_invoice = total_overdue = total_paid = 0.0
    n_overdue = 0
    for r in rows:
        (job_number, title, client, poool_status, quote_amount, invoice_amount,
         tpc, due, delivery_status, revisions, ticket_count, folder, notes) = r
        quote_amount = float(quote_amount or 0)
        invoice_amount = float(invoice_amount or 0)
        total_quote += quote_amount
        total_invoice += invoice_amount
        overdue = (
            poool_status in ("invoiced", "partially_paid")
            and due is not None and due < today
        )
        if overdue:
            n_overdue += 1
            total_overdue += invoice_amount or quote_amount
        if poool_status == "paid":
            total_paid += invoice_amount
        lines.append(
            f"- {job_number} | {title} | client={client or '—'} | poool={poool_status}"
            f"{' (OVERDUE)' if overdue else ''} | quote={_fmt_eur(quote_amount or None)}"
            f" | invoice={_fmt_eur(invoice_amount or None)} | 3rd-party={_fmt_eur(float(tpc) if tpc else None)}"
            f" | due={due.isoformat() if due else '—'} | delivery={delivery_status}"
            f" | revisions={revisions} | clickup_tickets={ticket_count}"
            f" | folder={'yes' if folder else 'no'}"
        )

    summary = (
        f"Today: {today.isoformat()}\n"
        f"Totals: jobs={len(rows)}, quoted={_fmt_eur(total_quote)}, "
        f"invoiced={_fmt_eur(total_invoice)}, paid={_fmt_eur(total_paid)}, "
        f"overdue_jobs={n_overdue}, overdue_amount={_fmt_eur(total_overdue)}\n"
    )
    if not rows:
        return summary + "JOB DATA: (no jobs yet)\n"
    return summary + "JOB DATA:\n" + "\n".join(lines) + "\n"


@router.post("", response_model=APIResponse[CopilotResponse])
async def ask_copilot(
    body: CopilotRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[CopilotResponse]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="empty message")

    context = await _build_job_context(db, tenant_id)
    messages = [{"role": "system", "content": _SYSTEM + "\n\n" + context}]
    # Keep the last few turns for continuity.
    for m in body.history[-8:]:
        if m.role in ("user", "assistant") and m.content.strip():
            messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": body.message})

    result = await chat(messages, max_tokens=900, temperature=0.2)
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "copilot unavailable")

    return APIResponse(
        data=CopilotResponse(answer=result["text"], model=result.get("model") or copilot_model()),
        message="ok",
    )


# ──────────────────────────────────────────────
# Supervisor — rule-based "next actions" queue (no LLM required).
# Computes prioritized, one-click actions from live job state. The PM
# approves each (HITL); execute maps the action to a safe local operation.
# ──────────────────────────────────────────────

class NextAction(BaseModel):
    job_id: str
    job_number: str
    client: str
    kind: str          # chase_payment | invoice | follow_up_quote
    priority: str      # high | medium | low
    label: str
    detail: str


class ExecuteActionRequest(BaseModel):
    job_id: str
    kind: str


def _days_since(d: date | None, today: date) -> int:
    return (today - d).days if d else 0


def _compute_actions(rows: list, today: date) -> list[NextAction]:
    actions: list[NextAction] = []
    for r in rows:
        (job_id, job_number, client, poool_status, quote_amount, invoice_amount,
         due, delivery_status, created) = r
        amt = float(invoice_amount or quote_amount or 0)
        # 1. Overdue invoice → chase payment (high).
        if poool_status in ("invoiced", "partially_paid", "overdue") and due is not None and due < today:
            actions.append(NextAction(
                job_id=str(job_id), job_number=job_number, client=client or "—",
                kind="chase_payment", priority="high", label="Chase payment",
                detail=f"€{amt:,.0f} · {_days_since(due, today)}d overdue",
            ))
            continue
        # 2. Delivered but not yet invoiced → invoice the client (high).
        if delivery_status in ("delivered", "archived") and poool_status in (
            "quote_pending", "quote_sent", "quote_approved",
        ):
            actions.append(NextAction(
                job_id=str(job_id), job_number=job_number, client=client or "—",
                kind="invoice", priority="high", label="Invoice client",
                detail="Delivered — raise the invoice",
            ))
            continue
        # 3. Quote pending/sent and aging → follow up (medium).
        if poool_status in ("quote_pending", "quote_sent") and _days_since(created.date() if hasattr(created, "date") else created, today) >= 5:
            actions.append(NextAction(
                job_id=str(job_id), job_number=job_number, client=client or "—",
                kind="follow_up_quote", priority="medium", label="Follow up quote",
                detail=f"Quote {poool_status.replace('_', ' ')} {_days_since(created.date() if hasattr(created, 'date') else created, today)}d",
            ))
    order = {"high": 0, "medium": 1, "low": 2}
    actions.sort(key=lambda a: order.get(a.priority, 3))
    return actions


async def _load_action_rows(db: AsyncSession, tenant_id: str) -> list:
    return (
        await db.execute(
            text(
                "SELECT id, job_number, client, poool_status, quote_amount, invoice_amount, "
                "payment_due_date, delivery_status, created_at "
                "FROM ops.jobs WHERE tenant_id = CAST(:tid AS uuid) ORDER BY created_at DESC"
            ),
            {"tid": tenant_id},
        )
    ).all()


@router.get("/next-actions", response_model=APIResponse[list[NextAction]])
async def next_actions(
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[list[NextAction]]:
    tenant_id = current_tenant_id.get("")
    rows = await _load_action_rows(db, tenant_id)
    return APIResponse(data=_compute_actions(rows, date.today()), message="ok")


@router.post("/next-actions/execute", response_model=APIResponse[NextAction | None])
async def execute_action(
    body: ExecuteActionRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[NextAction | None]:
    tenant_id = current_tenant_id.get("")
    row = (
        await db.execute(
            text(
                "SELECT job_number, client FROM ops.jobs "
                "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid)"
            ),
            {"id": body.job_id, "tid": tenant_id},
        )
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Job not found")
    job_number, client = row[0], row[1] or ""

    from aiteam.integrations.job_notifications import record_notification

    if body.kind == "chase_payment":
        await record_notification(
            tenant_id, kind="payment_reminder", job_id=body.job_id,
            subject=f"Zahlungserinnerung — {job_number} {client}",
            body=f"Reminder: the invoice for job {job_number} ({client}) is overdue.",
        )
    elif body.kind == "follow_up_quote":
        await record_notification(
            tenant_id, kind="quote_followup", job_id=body.job_id,
            subject=f"Angebot nachfassen — {job_number} {client}",
            body=f"Follow up on the open quote for job {job_number} ({client}).",
        )
    elif body.kind == "invoice":
        await db.execute(
            text(
                "UPDATE ops.jobs SET poool_status = 'invoiced', "
                "invoice_amount = COALESCE(invoice_amount, quote_amount), updated_at = now() "
                "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid)"
            ),
            {"id": body.job_id, "tid": tenant_id},
        )
        await db.commit()
        await record_notification(
            tenant_id, kind="invoice_raised", job_id=body.job_id,
            subject=f"Rechnung gestellt — {job_number} {client}",
            body=f"Invoice raised for job {job_number} ({client}).",
        )
    else:
        raise HTTPException(status_code=400, detail=f"unknown action: {body.kind}")

    return APIResponse(data=None, message=f"{body.kind} done")


# ──────────────────────────────────────────────
# POOOL sync summary — surfaces live ops.poool_cache in the Finance board.
# ──────────────────────────────────────────────

class PooolSyncSummary(BaseModel):
    connected: bool
    synced_at: str | None = None
    projects: int = 0
    orders: int = 0
    clients: int = 0
    recent_orders: list[dict] = Field(default_factory=list)


@router.get("/poool-summary", response_model=APIResponse[PooolSyncSummary])
async def poool_summary(
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[PooolSyncSummary]:
    tenant_id = current_tenant_id.get("")
    counts = {
        r[0]: int(r[1])
        for r in (
            await db.execute(
                text(
                    "SELECT kind, count(*) FROM ops.poool_cache "
                    "WHERE tenant_id = CAST(:tid AS uuid) GROUP BY kind"
                ),
                {"tid": tenant_id},
            )
        ).all()
    }
    synced_at = (
        await db.execute(
            text(
                "SELECT max(fetched_at) FROM ops.poool_cache "
                "WHERE tenant_id = CAST(:tid AS uuid)"
            ),
            {"tid": tenant_id},
        )
    ).scalar_one_or_none()
    order_rows = (
        await db.execute(
            text(
                "SELECT external_id, payload->>'title' AS title FROM ops.poool_cache "
                "WHERE tenant_id = CAST(:tid AS uuid) AND kind = 'order' "
                "ORDER BY fetched_at DESC LIMIT 6"
            ),
            {"tid": tenant_id},
        )
    ).all()
    total = sum(counts.values())
    return APIResponse(
        data=PooolSyncSummary(
            connected=total > 0,
            synced_at=synced_at.isoformat() if synced_at else None,
            projects=counts.get("project", 0),
            orders=counts.get("order", 0),
            clients=counts.get("client", 0),
            recent_orders=[{"id": r[0], "title": r[1] or "(untitled)"} for r in order_rows],
        ),
        message="ok",
    )

