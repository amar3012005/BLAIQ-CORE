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
