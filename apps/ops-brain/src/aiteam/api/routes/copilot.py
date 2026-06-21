"""Admin Copilot (Track AA, phase AA1).

A chat endpoint grounded in the tenant's live jobs. The dataset is small (a
handful of jobs per tenant), so rather than tool-calling we load the jobs +
a computed finance summary straight into the system prompt and let the model
answer. Read-only: no mutations here — agentic actions land in AA2.
"""

from __future__ import annotations

import asyncio
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
    # Ground the AI in the real POOOL sync too (read-only) so it can answer
    # about the actual POOOL pipeline, not just BLAIQ's internal job records.
    summary += await _poool_context_line(db, tenant_id)
    if not rows:
        return summary + "JOB DATA: (no jobs yet)\n"
    return summary + "JOB DATA:\n" + "\n".join(lines) + "\n"


async def _load_brand_md(db: AsyncSession, tenant_id: str) -> tuple[str, str]:
    """Read brand_dna_md + brand_tone_md from tenant_brand (read-only)."""
    row = (
        await db.execute(
            text(
                "SELECT brand_dna_md, brand_tone_md FROM tenant_brand "
                "WHERE tenant_id = CAST(:tid AS uuid)"
            ),
            {"tid": tenant_id},
        )
    ).first()
    if not row:
        return "", ""
    return (row[0] or ""), (row[1] or "")


async def _poool_context_line(db: AsyncSession, tenant_id: str) -> str:
    """One-line real POOOL summary for the AI grounding context (read-only)."""
    row = (
        await db.execute(
            text(
                "SELECT "
                "count(*) FILTER (WHERE kind='client'), "
                "count(*) FILTER (WHERE kind='project'), "
                "count(*) FILTER (WHERE kind='order'), "
                "COALESCE(sum(NULLIF(payload->>'total_netto_sum','')::numeric) FILTER (WHERE kind='order'),0), "
                "COALESCE(sum(NULLIF(payload->>'total_brutto_sum','')::numeric) FILTER (WHERE kind='order'),0) "
                "FROM ops.poool_cache WHERE tenant_id = CAST(:tid AS uuid)"
            ),
            {"tid": tenant_id},
        )
    ).first()
    if not row or (int(row[0]) == 0 and int(row[1]) == 0 and int(row[2]) == 0):
        return "POOOL (live sync): not connected.\n"
    return (
        f"POOOL (live sync, real data): {int(row[0])} clients, {int(row[1])} projects, "
        f"{int(row[2])} orders; real pipeline {_fmt_eur(float(row[4]))} brutto / "
        f"{_fmt_eur(float(row[3]))} netto.\n"
    )


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


async def _execute_one_action(db: AsyncSession, tenant_id: str, job_id: str, kind: str) -> str:
    """Run a single supervisor action. Raises ValueError on bad input so the
    caller can map it (HTTP 4xx for one, per-item failure for a batch)."""
    row = (
        await db.execute(
            text(
                "SELECT job_number, client FROM ops.jobs "
                "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid)"
            ),
            {"id": job_id, "tid": tenant_id},
        )
    ).first()
    if not row:
        raise ValueError("Job not found")
    job_number, client = row[0], row[1] or ""

    from aiteam.integrations.job_notifications import record_notification

    if kind == "chase_payment":
        await record_notification(
            tenant_id, kind="payment_reminder", job_id=job_id,
            subject=f"Zahlungserinnerung — {job_number} {client}",
            body=f"Reminder: the invoice for job {job_number} ({client}) is overdue.",
        )
    elif kind == "follow_up_quote":
        await record_notification(
            tenant_id, kind="quote_followup", job_id=job_id,
            subject=f"Angebot nachfassen — {job_number} {client}",
            body=f"Follow up on the open quote for job {job_number} ({client}).",
        )
    elif kind == "invoice":
        await db.execute(
            text(
                "UPDATE ops.jobs SET poool_status = 'invoiced', "
                "invoice_amount = COALESCE(invoice_amount, quote_amount), updated_at = now() "
                "WHERE id = CAST(:id AS uuid) AND tenant_id = CAST(:tid AS uuid)"
            ),
            {"id": job_id, "tid": tenant_id},
        )
        await db.commit()
        await record_notification(
            tenant_id, kind="invoice_raised", job_id=job_id,
            subject=f"Rechnung gestellt — {job_number} {client}",
            body=f"Invoice raised for job {job_number} ({client}).",
        )
    else:
        raise ValueError(f"unknown action: {kind}")

    return f"{kind} done · {job_number}"


@router.post("/next-actions/execute", response_model=APIResponse[NextAction | None])
async def execute_action(
    body: ExecuteActionRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[NextAction | None]:
    tenant_id = current_tenant_id.get("")
    try:
        msg = await _execute_one_action(db, tenant_id, body.job_id, body.kind)
    except ValueError as e:
        code = 404 if "not found" in str(e).lower() else 400
        raise HTTPException(status_code=code, detail=str(e))
    return APIResponse(data=None, message=msg)


# AA6 — "Run the Agency": approve the whole prioritised batch in one pass.
# Each item runs independently; one failure never blocks the rest (HITL still
# applies — the PM has already seen and approved the list in the UI).

class BatchItem(BaseModel):
    job_id: str
    kind: str


class ExecuteBatchRequest(BaseModel):
    actions: list[BatchItem] = Field(default_factory=list)


class BatchResult(BaseModel):
    job_id: str
    kind: str
    ok: bool
    message: str


@router.post("/next-actions/execute-batch", response_model=APIResponse[list[BatchResult]])
async def execute_action_batch(
    body: ExecuteBatchRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[list[BatchResult]]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    results: list[BatchResult] = []
    for item in body.actions:
        try:
            msg = await _execute_one_action(db, tenant_id, item.job_id, item.kind)
            results.append(BatchResult(job_id=item.job_id, kind=item.kind, ok=True, message=msg))
        except Exception as e:  # noqa: BLE001 — per-item isolation; report, don't abort
            results.append(BatchResult(job_id=item.job_id, kind=item.kind, ok=False, message=str(e)))
    done = sum(1 for r in results if r.ok)
    return APIResponse(data=results, message=f"{done}/{len(results)} done")


# ──────────────────────────────────────────────
# POOOL sync summary — surfaces live ops.poool_cache in the Finance board.
# ──────────────────────────────────────────────

class PooolSyncSummary(BaseModel):
    connected: bool
    synced_at: str | None = None
    projects: int = 0
    orders: int = 0
    clients: int = 0
    # Real € pipeline from the cached POOOL orders (read-only, never written).
    pipeline_netto: float = 0.0
    pipeline_brutto: float = 0.0
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
                "SELECT external_id, payload->>'title' AS title, "
                "NULLIF(payload->>'total_netto_sum','')::numeric AS netto, "
                "NULLIF(payload->>'total_brutto_sum','')::numeric AS brutto, "
                "payload->>'order_state_id' AS state "
                "FROM ops.poool_cache "
                "WHERE tenant_id = CAST(:tid AS uuid) AND kind = 'order' "
                "ORDER BY fetched_at DESC LIMIT 8"
            ),
            {"tid": tenant_id},
        )
    ).all()
    # Real pipeline totals across ALL cached orders (read-only).
    pipeline = (
        await db.execute(
            text(
                "SELECT COALESCE(sum(NULLIF(payload->>'total_netto_sum','')::numeric),0), "
                "COALESCE(sum(NULLIF(payload->>'total_brutto_sum','')::numeric),0) "
                "FROM ops.poool_cache WHERE tenant_id = CAST(:tid AS uuid) AND kind = 'order'"
            ),
            {"tid": tenant_id},
        )
    ).first()
    total = sum(counts.values())
    return APIResponse(
        data=PooolSyncSummary(
            connected=total > 0,
            synced_at=synced_at.isoformat() if synced_at else None,
            projects=counts.get("project", 0),
            orders=counts.get("order", 0),
            clients=counts.get("client", 0),
            pipeline_netto=float(pipeline[0]) if pipeline and pipeline[0] is not None else 0.0,
            pipeline_brutto=float(pipeline[1]) if pipeline and pipeline[1] is not None else 0.0,
            recent_orders=[
                {
                    "id": r[0],
                    "title": r[1] or "(untitled)",
                    "netto": float(r[2]) if r[2] is not None else None,
                    "brutto": float(r[3]) if r[3] is not None else None,
                    "state": r[4],
                }
                for r in order_rows
            ],
        ),
        message="ok",
    )


# ──────────────────────────────────────────────
# Activity feed — tenant-wide notifications timeline (delivery/overdue/etc).
# ──────────────────────────────────────────────

class ActivityItem(BaseModel):
    id: int
    kind: str
    subject: str
    status: str
    created_at: str | None = None


@router.get("/activity", response_model=APIResponse[list[ActivityItem]])
async def activity_feed(
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[list[ActivityItem]]:
    tenant_id = current_tenant_id.get("")
    rows = (
        await db.execute(
            text(
                "SELECT id, kind, subject, status, created_at FROM ops.notifications "
                "WHERE tenant_id = CAST(:tid AS uuid) ORDER BY created_at DESC LIMIT 50"
            ),
            {"tid": tenant_id},
        )
    ).all()
    items = [
        ActivityItem(
            id=int(r[0]), kind=r[1], subject=r[2], status=r[3],
            created_at=r[4].isoformat() if r[4] else None,
        )
        for r in rows
    ]
    return APIResponse(data=items, message="ok")



# ──────────────────────────────────────────────
# Agentic actions (AA2) — the Copilot proposes a tool call; the PM approves
# it in the UI (HITL). Nothing here executes; execution runs through the
# existing job-action endpoints once the PM clicks Approve.
# ──────────────────────────────────────────────

def _act_tool(name: str, desc: str, props: dict, required: list[str]) -> dict:
    return {
        "type": "function",
        "function": {
            "name": name,
            "description": desc,
            "parameters": {"type": "object", "properties": props, "required": required},
        },
    }


_JOB_ARG = {"job_number": {"type": "string", "description": "The job number, e.g. 2026-014"}}

_ACTION_TOOLS = [
    _act_tool("mark_delivered", "Mark a job as delivered to the client.", _JOB_ARG, ["job_number"]),
    _act_tool("push_poool", "Create a POOOL project + quote for a job.", _JOB_ARG, ["job_number"]),
    _act_tool("push_clickup", "Create a ClickUp ticket for a job.", _JOB_ARG, ["job_number"]),
    _act_tool("create_server_folder", "Create the delivery server folder for a job.", _JOB_ARG, ["job_number"]),
    _act_tool("chase_payment", "Send a payment reminder for an overdue job.", _JOB_ARG, ["job_number"]),
    _act_tool(
        "set_poool_status", "Set the POOOL finance status of a job.",
        {**_JOB_ARG, "status": {"type": "string", "enum": [
            "quote_pending", "quote_sent", "quote_approved", "invoiced",
            "partially_paid", "paid", "overdue"]}},
        ["job_number", "status"],
    ),
]

_ACTION_LABELS = {
    "mark_delivered": "Mark delivered",
    "push_poool": "Push to POOOL",
    "push_clickup": "Push to ClickUp",
    "create_server_folder": "Create server folder",
    "chase_payment": "Send payment reminder",
    "set_poool_status": "Set finance status",
}

_ACT_SYSTEM = """You are the BLAIQ Admin Copilot. The PM can ask a question OR ask you to perform an action on a job.
- If the user asks you to DO something (deliver, invoice, push to POOOL/ClickUp, create the server folder, chase a payment, change finance status), call the matching tool, resolving the job_number from the JOB DATA (match by number, client name, or title).
- If it's just a question, answer in plain text and do NOT call a tool.
- A tool call is only a PROPOSAL the PM approves — never claim you executed anything."""


class ProposedAction(BaseModel):
    kind: str
    job_id: str | None = None
    job_number: str | None = None
    args: dict = Field(default_factory=dict)
    summary: str


class ActResponse(BaseModel):
    answer: str | None = None
    proposed: ProposedAction | None = None
    model: str


@router.post("/act", response_model=APIResponse[ActResponse])
async def copilot_act(
    body: CopilotRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[ActResponse]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="empty message")

    context = await _build_job_context(db, tenant_id)
    messages = [{"role": "system", "content": _ACT_SYSTEM + "\n\n" + context}]
    for m in body.history[-6:]:
        if m.role in ("user", "assistant") and m.content.strip():
            messages.append({"role": m.role, "content": m.content})
    messages.append({"role": "user", "content": body.message})

    result = await chat(messages, max_tokens=700, temperature=0.1, tools=_ACTION_TOOLS)
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "copilot unavailable")

    tool_calls = result.get("tool_calls")
    if tool_calls:
        import json as _json
        fn = (tool_calls[0] or {}).get("function", {})
        name = fn.get("name", "")
        try:
            args = _json.loads(fn.get("arguments") or "{}")
        except (ValueError, TypeError):
            args = {}
        job_number = args.get("job_number")
        job_id = None
        if job_number:
            row = (
                await db.execute(
                    text(
                        "SELECT id FROM ops.jobs WHERE job_number = :jn "
                        "AND tenant_id = CAST(:tid AS uuid)"
                    ),
                    {"jn": job_number, "tid": tenant_id},
                )
            ).first()
            if row:
                job_id = str(row[0])
        label = _ACTION_LABELS.get(name, name)
        extra = f" → {args.get('status')}" if name == "set_poool_status" else ""
        summary = f"{label}{extra} · {job_number or '(job?)'}"
        return APIResponse(
            data=ActResponse(
                proposed=ProposedAction(
                    kind=name, job_id=job_id, job_number=job_number, args=args, summary=summary
                ),
                model=result.get("model") or copilot_model(),
            ),
            message="proposed",
        )

    return APIResponse(
        data=ActResponse(answer=result.get("text") or "", model=result.get("model") or copilot_model()),
        message="ok",
    )


# ──────────────────────────────────────────────
# AA5 — AI Crew. Instead of one Copilot, a small crew of specialist agents
# (Finance, Delivery, Account) reviews ONE job in parallel — each from its own
# remit — and may PROPOSE an action. Proposals reuse _ACTION_TOOLS and the
# ProposedAction shape, so the PM approves them (HITL) through the very same
# job-action endpoints as AA2. This is the agency org-chart, as agents.
# ──────────────────────────────────────────────

_CREW = [
    {
        "id": "finance",
        "name": "Mara",
        "role": "Finance Lead",
        "emoji": "💰",
        "tools": ["push_poool", "set_poool_status", "chase_payment"],
        "brief": (
            "You own cash. Watch the quote→invoice→paid pipeline, the margin "
            "(invoice or quote minus third-party costs), and overdue payments. "
            "Flag money left on the table or at risk of going uncollected."
        ),
    },
    {
        "id": "delivery",
        "name": "Tomas",
        "role": "Delivery Lead",
        "emoji": "📦",
        "tools": ["mark_delivered", "create_server_folder"],
        "brief": (
            "You own production and handover. Watch delivery status, whether the "
            "server delivery folder exists, and revision rounds. Flag jobs ready "
            "to deliver or missing their folder."
        ),
    },
    {
        "id": "account",
        "name": "Lena",
        "role": "Account Manager",
        "emoji": "🤝",
        "tools": ["chase_payment", "push_clickup"],
        "brief": (
            "You own the client relationship. Watch for stale quotes, slow "
            "follow-ups, and anything client-facing that needs a nudge. Keep the "
            "client warm and the next step moving."
        ),
    },
]

_CREW_SYSTEM = """You are {name}, the {role} on the BLAIQ AI crew at the creative agency B&B Markenagentur.
{brief}

You are reviewing ONE job (details below). Give your assessment in ONE or TWO sentences, strictly from your role's perspective, grounded in the job data and citing the job number. Money is in EUR; today's date is given.
If — and only if — a clear action within your remit is warranted, call exactly one tool to PROPOSE it. A tool call is only a proposal the PM approves; never claim you executed anything. If no action is needed, do not call a tool."""


def _tools_for(names: list[str]) -> list[dict]:
    return [t for t in _ACTION_TOOLS if t["function"]["name"] in names]


# Full per-job select (id first), shared by the crew target picker.
_CREW_JOB_SELECT = (
    "SELECT id, job_number, title, client, poool_status, quote_amount, "
    "invoice_amount, third_party_costs, payment_due_date, delivery_status, "
    "revision_count, COALESCE(jsonb_array_length(clickup_ticket_ids),0), "
    "server_folder_path, notes "
    "FROM ops.jobs WHERE tenant_id = CAST(:tid AS uuid) ORDER BY created_at DESC"
)


def _crew_risk_score(r, today: date) -> float:
    poool_status, due, delivery = r[4], r[8], r[9]
    if poool_status in ("invoiced", "partially_paid", "overdue") and due is not None and due < today:
        return 100.0 + (today - due).days
    if delivery in ("delivered", "archived") and poool_status in ("quote_pending", "quote_sent", "quote_approved"):
        return 80.0
    if poool_status in ("quote_pending", "quote_sent"):
        return 50.0
    return 10.0


def _crew_job_detail(r, today: date) -> str:
    (_id, jn, title, client, poool_status, quote, invoice, tpc, due,
     delivery, revs, tickets, folder, notes) = r
    quote = float(quote or 0)
    invoice = float(invoice or 0)
    tpc_v = float(tpc or 0)
    margin = (invoice or quote) - tpc_v
    overdue = (
        poool_status in ("invoiced", "partially_paid", "overdue")
        and due is not None and due < today
    )
    return (
        f"Job {jn} — {title}\n"
        f"Client: {client or '—'}\n"
        f"Finance: poool_status={poool_status}{' (OVERDUE)' if overdue else ''}, "
        f"quote={_fmt_eur(quote or None)}, invoice={_fmt_eur(invoice or None)}, "
        f"third_party_costs={_fmt_eur(tpc_v or None)}, margin≈{_fmt_eur(margin or None)}, "
        f"payment_due={due.isoformat() if due else '—'}\n"
        f"Delivery: status={delivery}, server_folder={'yes' if folder else 'no'}, revisions={revs}\n"
        f"Tasks: clickup_tickets={tickets}\n"
        f"Notes: {notes or '—'}\n"
    )


class CrewRequest(BaseModel):
    job_number: str | None = None


class CrewFinding(BaseModel):
    id: str
    agent: str
    role: str
    emoji: str
    assessment: str
    proposed: ProposedAction | None = None


class CrewDeliberation(BaseModel):
    job_id: str
    job_number: str
    title: str
    findings: list[CrewFinding]
    model: str


def _proposal_from_tool_calls(tool_calls: list, job_id: str, job_number: str) -> ProposedAction | None:
    if not tool_calls:
        return None
    import json as _json
    fn = (tool_calls[0] or {}).get("function", {})
    name = fn.get("name", "")
    if not name:
        return None
    try:
        args = _json.loads(fn.get("arguments") or "{}")
    except (ValueError, TypeError):
        args = {}
    label = _ACTION_LABELS.get(name, name)
    extra = f" → {args.get('status')}" if name == "set_poool_status" else ""
    return ProposedAction(
        kind=name, job_id=job_id, job_number=job_number, args=args,
        summary=f"{label}{extra} · {job_number}",
    )


async def _deliberate_job(target, today: date) -> CrewDeliberation:
    """Run the full crew over one job row (id-first tuple from _CREW_JOB_SELECT).
    Specialists run concurrently; each may propose an action."""
    job_id = str(target[0])
    job_number = target[1]
    title = target[2]
    detail = _crew_job_detail(target, today)

    async def _run(member: dict):
        system = _CREW_SYSTEM.format(name=member["name"], role=member["role"], brief=member["brief"])
        system += f"\n\nToday: {today.isoformat()}\n\nJOB UNDER REVIEW:\n{detail}"
        messages = [
            {"role": "system", "content": system},
            {"role": "user", "content": f"Review job {job_number} from your role and propose an action if one is warranted."},
        ]
        res = await chat(messages, max_tokens=320, temperature=0.2, tools=_tools_for(member["tools"]))
        return member, res

    results = await asyncio.gather(*(_run(m) for m in _CREW))

    findings: list[CrewFinding] = []
    model_used = copilot_model()
    for member, res in results:
        if not res.get("ok"):
            findings.append(CrewFinding(
                id=member["id"], agent=member["name"], role=member["role"], emoji=member["emoji"],
                assessment="(unavailable — LLM error)",
            ))
            continue
        model_used = res.get("model") or model_used
        assessment = (res.get("text") or "").strip()
        proposed = _proposal_from_tool_calls(res.get("tool_calls") or [], job_id, job_number)
        if proposed and not assessment:
            assessment = f"Recommends: {proposed.summary}."
        if not assessment:
            assessment = "No action needed from my side right now."
        findings.append(CrewFinding(
            id=member["id"], agent=member["name"], role=member["role"], emoji=member["emoji"],
            assessment=assessment, proposed=proposed,
        ))

    return CrewDeliberation(
        job_id=job_id, job_number=job_number, title=title,
        findings=findings, model=model_used,
    )


@router.post("/crew", response_model=APIResponse[CrewDeliberation])
async def crew_deliberate(
    body: CrewRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[CrewDeliberation]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")

    rows = (await db.execute(text(_CREW_JOB_SELECT), {"tid": tenant_id})).all()
    if not rows:
        raise HTTPException(status_code=404, detail="no jobs to review")

    today = date.today()
    if body.job_number:
        target = next((r for r in rows if r[1] == body.job_number), None)
        if target is None:
            raise HTTPException(status_code=404, detail=f"job {body.job_number} not found")
    else:
        # Default: send the crew at the single most at-risk job.
        target = max(rows, key=lambda r: _crew_risk_score(r, today))

    return APIResponse(data=await _deliberate_job(target, today), message="ok")


# Crew Sweep — send the full crew across the top-N at-risk jobs in one pass.
# Each job's crew runs concurrently with the others, so the whole standup is
# bounded by the slowest single job, not their sum. Capped to keep LLM cost
# predictable; the skipped count is reported, never silently dropped.

class CrewSweepRequest(BaseModel):
    limit: int = 3


class CrewSweep(BaseModel):
    reviewed: int
    total_jobs: int
    skipped: int
    deliberations: list[CrewDeliberation]
    model: str


@router.post("/crew/sweep", response_model=APIResponse[CrewSweep])
async def crew_sweep(
    body: CrewSweepRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[CrewSweep]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")

    rows = (await db.execute(text(_CREW_JOB_SELECT), {"tid": tenant_id})).all()
    if not rows:
        raise HTTPException(status_code=404, detail="no jobs to review")

    today = date.today()
    limit = max(1, min(int(body.limit or 3), 5))
    ranked = sorted(rows, key=lambda r: _crew_risk_score(r, today), reverse=True)
    targets = ranked[:limit]

    deliberations = await asyncio.gather(*(_deliberate_job(t, today) for t in targets))
    model_used = next((d.model for d in deliberations if d.model), copilot_model())

    return APIResponse(
        data=CrewSweep(
            reviewed=len(deliberations),
            total_jobs=len(rows),
            skipped=max(0, len(rows) - len(deliberations)),
            deliberations=list(deliberations),
            model=model_used,
        ),
        message="ok",
    )


# ──────────────────────────────────────────────
# AA4 — AI Daily Briefing. A proactive "Chief of Staff" pass over the WHOLE
# job book: one LLM call returns a structured morning digest (headline,
# prioritised insights with severity + job refs, a cash-watch line). This is
# the company standup; the per-job drill-down lives in the Crew (AA5) and the
# one-click fixes in the Supervisor queue.
# ──────────────────────────────────────────────

_BRIEFING_SYSTEM = """You are the Chief of Staff for the creative agency B&B Markenagentur, briefing the project manager.
From the JOB DATA below, write a short, punchy morning briefing on the state of the agency.

Respond with ONLY a JSON object (no markdown, no prose around it) of exactly this shape:
{
  "headline": "one sentence on the overall state of the agency right now",
  "cash_watch": "one sentence on cash: what is overdue, what is about to be invoiced/collected (EUR)",
  "insights": [
    {"severity": "high|medium|low", "title": "short title", "detail": "one or two sentences, concrete", "job_number": "2026-014 or null", "action": "the single next step, or null"}
  ]
}

Rules:
- 3 to 5 insights, ordered most urgent first. Ground every claim in the JOB DATA; cite job numbers. Never invent jobs or numbers.
- "high" = money at risk or a client/delivery problem; "medium" = should act this week; "low" = informational.
- Money is in EUR. Today's date is given below. Output JSON only."""


class BriefingInsight(BaseModel):
    severity: str = "low"
    title: str
    detail: str = ""
    job_number: str | None = None
    action: str | None = None
    # When the insight's job has a matching rule-based Supervisor action, these
    # let the standup run it in one click (FE → /next-actions/execute).
    job_id: str | None = None
    act_kind: str | None = None
    act_label: str | None = None


class Briefing(BaseModel):
    headline: str
    cash_watch: str = ""
    insights: list[BriefingInsight] = Field(default_factory=list)
    generated_on: str
    model: str


def _parse_briefing_json(raw: str) -> dict:
    import json as _json
    s = (raw or "").strip()
    if s.startswith("```"):
        # strip ```json … ``` fences
        s = s.split("```", 2)[1] if s.count("```") >= 2 else s.strip("`")
        if s.lower().startswith("json"):
            s = s[4:]
    s = s.strip()
    start, end = s.find("{"), s.rfind("}")
    if start != -1 and end != -1 and end > start:
        s = s[start:end + 1]
    return _json.loads(s)


@router.get("/briefing", response_model=APIResponse[Briefing])
async def briefing(
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[Briefing]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")

    today = date.today()
    context = await _build_job_context(db, tenant_id)
    messages = [
        {"role": "system", "content": _BRIEFING_SYSTEM + "\n\n" + context},
        {"role": "user", "content": "Give me today's briefing."},
    ]
    result = await chat(messages, max_tokens=900, temperature=0.2)
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "briefing unavailable")

    model_used = result.get("model") or copilot_model()
    # Rule-based Supervisor actions, keyed by job_number, so we can make each
    # insight one-click runnable (the LLM picks the narrative; the rule engine
    # supplies the safe, executable action).
    action_rows = await _load_action_rows(db, tenant_id)
    action_by_job = {a.job_number: a for a in _compute_actions(action_rows, today)}
    try:
        parsed = _parse_briefing_json(result.get("text") or "")
        insights = []
        for i in (parsed.get("insights") or []):
            if not isinstance(i, dict):
                continue
            jn = str(i["job_number"]).strip() if i.get("job_number") else None
            act = action_by_job.get(jn) if jn else None
            insights.append(BriefingInsight(
                severity=str(i.get("severity") or "low").lower(),
                title=str(i.get("title") or "").strip() or "Insight",
                detail=str(i.get("detail") or "").strip(),
                job_number=jn,
                action=(str(i["action"]).strip() if i.get("action") else None),
                job_id=act.job_id if act else None,
                act_kind=act.kind if act else None,
                act_label=act.label if act else None,
            ))
        data = Briefing(
            headline=str(parsed.get("headline") or "").strip() or "Agency briefing",
            cash_watch=str(parsed.get("cash_watch") or "").strip(),
            insights=insights,
            generated_on=today.isoformat(),
            model=model_used,
        )
    except (ValueError, TypeError, KeyError):
        # Fallback: surface the raw model text as a single insight rather than 500.
        data = Briefing(
            headline="Agency briefing",
            cash_watch="",
            insights=[BriefingInsight(severity="low", title="Briefing", detail=(result.get("text") or "").strip()[:600])],
            generated_on=today.isoformat(),
            model=model_used,
        )

    return APIResponse(data=data, message="ok")


# ──────────────────────────────────────────────
# GenAI · Decks (Track B). Brand-locked slide-deck generation: read the tenant's
# Brand DNA + Tone, let the LLM extract on-brand visual tokens AND write the
# slide content for a topic, then render a self-contained HTML deck whose :root
# carries the brand palette/typography. Output is the actual deck (verifiable by
# rendering it) — no POOOL, no external writes.
# ──────────────────────────────────────────────

import html as _html

_DECK_SYSTEM = """You are a senior presentation designer at the creative agency B&B Markenagentur.
Produce a clean, minimal, on-brand slide deck for the given topic.

You are given the agency's Brand DNA (visual identity) and Brand Tone (voice). Rules:
- Pull the colour palette and typography from the Brand DNA VERBATIM where given. For anything missing, choose the closest elegant on-brand value (do not invent loud/generic colours).
- All copy must follow the Brand Tone — vocabulary, archetype, rhythm. Concise, confident, no filler.
- Each content slide: a short heading + 2–4 tight bullet points. Avoid walls of text.

Respond with ONLY a JSON object of exactly this shape:
{
  "title": "deck title",
  "subtitle": "one-line subtitle",
  "bg": "#hex background", "ink": "#hex main text", "muted": "#hex secondary text", "accent": "#hex accent",
  "font": "a CSS font-family stack, e.g. 'Inter, Helvetica, Arial, sans-serif'",
  "slides": [ {"heading": "...", "bullets": ["...", "..."]} ]
}
Output JSON only — no markdown fences, no prose."""


class DeckRequest(BaseModel):
    topic: str
    slides: int = 6


class DeckResponse(BaseModel):
    html: str
    title: str
    slide_count: int
    palette: dict
    model: str


def _render_deck_html(spec: dict) -> str:
    bg = str(spec.get("bg") or "#F1F0EC")
    ink = str(spec.get("ink") or "#111111")
    muted = str(spec.get("muted") or "#6E6A63")
    accent = str(spec.get("accent") or "#C8553D")
    font = str(spec.get("font") or "'Inter', Helvetica, Arial, sans-serif")
    title = _html.escape(str(spec.get("title") or "Untitled"))
    subtitle = _html.escape(str(spec.get("subtitle") or ""))

    def esc(s: object) -> str:
        return _html.escape(str(s))

    slides_html = [
        f'<section class="slide title-slide active">'
        f'<div class="kicker">B&amp;B MARKENAGENTUR</div>'
        f'<h1>{title}</h1>'
        f'<p class="sub">{subtitle}</p></section>'
    ]
    for i, sl in enumerate(spec.get("slides") or [], start=1):
        if not isinstance(sl, dict):
            continue
        heading = esc(sl.get("heading") or "")
        bullets = "".join(
            f"<li>{esc(b)}</li>" for b in (sl.get("bullets") or []) if str(b).strip()
        )
        slides_html.append(
            f'<section class="slide">'
            f'<div class="num">{i:02d}</div>'
            f'<h2>{heading}</h2>'
            f'<ul>{bullets}</ul></section>'
        )
    total = len(slides_html)
    body = "\n".join(slides_html)
    return f"""<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
:root {{ --bg:{bg}; --ink:{ink}; --muted:{muted}; --accent:{accent}; --font:{font}; }}
* {{ box-sizing:border-box; margin:0; padding:0; }}
html,body {{ height:100%; background:#111; font-family:var(--font); }}
.stage {{ position:relative; width:100vw; height:100vh; overflow:hidden; }}
.slide {{ position:absolute; inset:0; display:none; flex-direction:column; justify-content:center;
  padding:9vh 10vw; background:var(--bg); color:var(--ink); }}
.slide.active {{ display:flex; }}
.kicker {{ font-size:1.1vw; letter-spacing:.4em; color:var(--muted); margin-bottom:3vh; }}
.title-slide h1 {{ font-size:6.5vw; line-height:1.05; font-weight:800; letter-spacing:-.02em; max-width:80%; }}
.title-slide .sub {{ font-size:2vw; color:var(--muted); margin-top:3vh; max-width:70%; }}
.title-slide::after {{ content:""; position:absolute; left:10vw; bottom:9vh; width:9vw; height:.6vh; background:var(--accent); }}
.slide h2 {{ font-size:3.6vw; font-weight:700; letter-spacing:-.01em; margin-bottom:4vh; }}
.slide h2::before {{ content:""; display:block; width:6vw; height:.5vh; background:var(--accent); margin-bottom:2.5vh; }}
.slide ul {{ list-style:none; display:flex; flex-direction:column; gap:2.4vh; }}
.slide li {{ font-size:1.9vw; line-height:1.4; padding-left:2.4vw; position:relative; max-width:78%; }}
.slide li::before {{ content:""; position:absolute; left:0; top:.8vh; width:1vw; height:1vw; background:var(--accent); border-radius:50%; }}
.num {{ position:absolute; top:8vh; right:10vw; font-size:1.4vw; color:var(--accent); letter-spacing:.2em; }}
.foot {{ position:fixed; bottom:3vh; right:4vw; font-size:1vw; color:var(--muted); z-index:5; }}
</style></head>
<body><div class="stage">
{body}
<div class="foot">B&amp;B · <span id="pg">1</span>/{total}</div>
</div>
<script>
let i=0; const s=[...document.querySelectorAll('.slide')];
function go(n){{ i=Math.max(0,Math.min(s.length-1,n)); s.forEach((e,k)=>e.classList.toggle('active',k===i)); document.getElementById('pg').textContent=i+1; }}
document.addEventListener('keydown',e=>{{ if(e.key==='ArrowRight'||e.key===' ')go(i+1); if(e.key==='ArrowLeft')go(i-1); }});
document.addEventListener('click',()=>go(i+1));
</script></body></html>"""


@router.post("/deck", response_model=APIResponse[DeckResponse])
async def generate_deck(
    body: DeckRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[DeckResponse]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    if not body.topic.strip():
        raise HTTPException(status_code=400, detail="empty topic")

    dna, tone = await _load_brand_md(db, tenant_id)
    n = max(3, min(int(body.slides or 6), 12))
    prompt = (
        f"BRAND DNA (visual identity):\n{dna or '(none set — choose minimal, elegant defaults)'}\n\n"
        f"BRAND TONE (voice):\n{tone or '(none set — confident, concise, professional)'}\n\n"
        f"TOPIC: {body.topic}\nMake exactly {n} content slides."
    )
    result = await chat(
        [{"role": "system", "content": _DECK_SYSTEM}, {"role": "user", "content": prompt}],
        max_tokens=1500, temperature=0.4,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "deck generation unavailable")

    try:
        spec = _parse_briefing_json(result.get("text") or "")
    except (ValueError, TypeError):
        raise HTTPException(status_code=502, detail="deck model returned unparseable output")
    if not isinstance(spec, dict):
        raise HTTPException(status_code=502, detail="deck model returned no spec")

    deck_html = _render_deck_html(spec)
    palette = {k: spec.get(k) for k in ("bg", "ink", "muted", "accent", "font")}
    return APIResponse(
        data=DeckResponse(
            html=deck_html,
            title=str(spec.get("title") or body.topic),
            slide_count=len(spec.get("slides") or []),
            palette=palette,
            model=result.get("model") or copilot_model(),
        ),
        message="ok",
    )


# ──────────────────────────────────────────────
# GenAI · Social artifacts (Track B). Brand-locked copy for social platforms +
# reports, in Brand Tone, with a prefilled one-click "post" link to the
# platform's web composer (the user clicks publish — no API creds needed).
# Read-only on brand data; no external writes.
# ──────────────────────────────────────────────

from urllib.parse import quote as _urlquote

_SOCIAL_GUIDANCE = {
    "instagram": "Instagram caption: a punchy hook line, 2–4 short lines with line breaks, at most 1–2 emoji, end with 5–10 relevant hashtags.",
    "linkedin": "LinkedIn post: a strong first-line hook, 2–3 short paragraphs, a clear CTA, 3–5 professional hashtags. Confident, no fluff.",
    "x": "X / Twitter post: ONE post under 280 characters total, 1–2 hashtags max, sharp and quotable.",
    "facebook": "Facebook post: conversational, medium length, one clear point + CTA, 2–4 hashtags.",
    "report": "Short report / executive summary: a title, 3–5 sections with a heading + 1–2 sentences each. No hashtags, no emoji. Professional.",
}

_SOCIAL_SYSTEM = """You are the social & content lead at the creative agency B&B Markenagentur.
Write a single ready-to-publish piece for the requested platform about the topic.
The Brand Tone below governs every word — vocabulary, archetype, rhythm. Match the platform's format exactly.

Respond with ONLY a JSON object:
{ "title": "short internal title", "body": "the full post text, ready to publish", "hashtags": ["#one", "#two"] }
- body: the complete copy, in the brand's language (German if the brand is German). Include line breaks where natural. Do NOT put the hashtags inside body — list them in the hashtags array.
- hashtags: [] for reports. Output JSON only."""


class SocialRequest(BaseModel):
    platform: str = "linkedin"
    topic: str


class SocialArtifact(BaseModel):
    platform: str
    title: str
    body: str
    hashtags: list[str] = Field(default_factory=list)
    share_url: str | None = None
    char_count: int = 0
    model: str


def _social_share_url(platform: str, body: str, hashtags: list[str]) -> str | None:
    tags = " ".join(hashtags)
    full = (body + ("\n\n" + tags if tags else "")).strip()
    enc = _urlquote(full)
    if platform == "linkedin":
        return f"https://www.linkedin.com/feed/?shareActive=true&text={enc}"
    if platform == "x":
        return f"https://twitter.com/intent/tweet?text={enc}"
    if platform == "facebook":
        return f"https://www.facebook.com/sharer/sharer.php?u=https://bundb.de&quote={enc}"
    # instagram has no web post-composer intent; report is a document → no link.
    return None


@router.post("/social", response_model=APIResponse[SocialArtifact])
async def generate_social(
    body: SocialRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[SocialArtifact]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    if not body.topic.strip():
        raise HTTPException(status_code=400, detail="empty topic")
    platform = (body.platform or "linkedin").lower().strip()
    guidance = _SOCIAL_GUIDANCE.get(platform, _SOCIAL_GUIDANCE["linkedin"])

    dna, tone = await _load_brand_md(db, tenant_id)
    prompt = (
        f"BRAND TONE (voice — follow exactly):\n{tone or '(confident, concise, professional)'}\n\n"
        f"BRAND DNA (for context):\n{dna or '(none)'}\n\n"
        f"PLATFORM: {platform}\nFORMAT: {guidance}\n\nTOPIC: {body.topic}"
    )
    result = await chat(
        [{"role": "system", "content": _SOCIAL_SYSTEM}, {"role": "user", "content": prompt}],
        max_tokens=800, temperature=0.5,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "social generation unavailable")
    try:
        spec = _parse_briefing_json(result.get("text") or "")
    except (ValueError, TypeError):
        spec = {"title": body.topic, "body": (result.get("text") or "").strip(), "hashtags": []}

    text_body = str(spec.get("body") or "").strip()
    tags = [str(h).strip() for h in (spec.get("hashtags") or []) if str(h).strip()]
    return APIResponse(
        data=SocialArtifact(
            platform=platform,
            title=str(spec.get("title") or body.topic).strip(),
            body=text_body,
            hashtags=tags,
            share_url=_social_share_url(platform, text_body, tags),
            char_count=len(text_body),
            model=result.get("model") or copilot_model(),
        ),
        message="ok",
    )


# ──────────────────────────────────────────────
# GenAI · Hooks + virality (Higgsfield parity #7 — the Editor's QA pass).
# Given a concept/script, propose proven 3-second openers and score the
# stop-the-scroll potential, brand-tone aware. Read-only on brand data.
# ──────────────────────────────────────────────

class HooksRequest(BaseModel):
    concept: str = Field(..., description="campaign concept, script, or topic to QA")
    platform: str | None = None


class HookVariant(BaseModel):
    text: str
    angle: str
    why: str


class ViralityScore(BaseModel):
    score: int
    verdict: str
    strengths: list[str]
    improvements: list[str]


class HooksResponse(BaseModel):
    hooks: list[HookVariant]
    virality: ViralityScore
    model: str


_HOOKS_SYSTEM = """You are the Editor of the BLAIQ creative crew, running a final QA pass on an ad concept before it ships. You judge stop-the-scroll potential like a performance-creative strategist.

Respond with ONLY a JSON object:
{
  "hooks": [
    {"text": "a 3-second opening line / first frame caption", "angle": "curiosity gap | bold claim | pattern interrupt | relatable tension", "why": "1 short sentence on why it stops the scroll"}
  ],
  "virality": {
    "score": 0-100,
    "verdict": "one honest sentence on its viral potential",
    "strengths": ["2-3 concrete things working in its favour"],
    "improvements": ["2-3 concrete, specific fixes to raise the score"]
  }
}
Rules: exactly 4 hooks, each a DIFFERENT psychological angle, all in the Brand Tone and the brand's language (German if the brand is German). Be honest, not generous — a generic concept scores low. Output JSON only, no preamble, no markdown fence."""


@router.post("/hooks", response_model=APIResponse[HooksResponse])
async def generate_hooks(
    body: HooksRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[HooksResponse]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    if not body.concept.strip():
        raise HTTPException(status_code=400, detail="empty concept")

    dna, tone = await _load_brand_md(db, tenant_id)
    platform = (body.platform or "any").lower().strip()
    prompt = (
        f"BRAND TONE (voice — follow exactly):\n{tone or '(confident, concise, professional)'}\n\n"
        f"BRAND DNA (for context):\n{dna or '(none)'}\n\n"
        f"PLATFORM: {platform}\n\nCONCEPT / SCRIPT TO QA:\n{body.concept.strip()}"
    )
    result = await chat(
        [{"role": "system", "content": _HOOKS_SYSTEM}, {"role": "user", "content": prompt}],
        max_tokens=1100, temperature=0.6,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "hooks generation unavailable")
    try:
        spec = _parse_briefing_json(result.get("text") or "")
    except (ValueError, TypeError):
        spec = {}

    hooks: list[HookVariant] = []
    for h in (spec.get("hooks") or [])[:6]:
        if not isinstance(h, dict):
            continue
        txt = str(h.get("text") or "").strip()
        if not txt:
            continue
        hooks.append(HookVariant(text=txt, angle=str(h.get("angle") or "").strip(), why=str(h.get("why") or "").strip()))

    v = spec.get("virality") if isinstance(spec.get("virality"), dict) else {}
    try:
        score = max(0, min(100, int(float(v.get("score", 0)))))
    except (ValueError, TypeError):
        score = 0
    virality = ViralityScore(
        score=score,
        verdict=str(v.get("verdict") or "").strip(),
        strengths=[str(s).strip() for s in (v.get("strengths") or []) if str(s).strip()][:4],
        improvements=[str(s).strip() for s in (v.get("improvements") or []) if str(s).strip()][:4],
    )
    return APIResponse(
        data=HooksResponse(hooks=hooks, virality=virality, model=result.get("model") or copilot_model()),
        message="ok",
    )


# ──────────────────────────────────────────────
# GenAI · URL/product intake (Higgsfield parity #3 — "paste a link, get an ad").
# Fetch a product/app URL, extract a reusable product profile, cross-check it
# against the tenant's Brand DNA/Tone, and hand back a ready-to-run brief.
# ──────────────────────────────────────────────

class ProductIntakeRequest(BaseModel):
    url: str


class ProductProfile(BaseModel):
    url: str
    product_name: str
    one_liner: str
    value_props: list[str]
    audience: str
    observed_colors: list[str]
    observed_tone: str
    brand_fit: str
    suggested_brief: str
    model: str


_INTAKE_SYSTEM = """You are the Story Writer of the BLAIQ creative crew, turning a product page into a reusable creative brief. You extract what matters for an ad and judge how it fits the agency's brand.

Respond with ONLY a JSON object:
{
  "product_name": "the product / company name",
  "one_liner": "what it is, in one sharp sentence",
  "value_props": ["3-5 concrete benefits / differentiators pulled from the page"],
  "audience": "who it's for",
  "observed_colors": ["any brand hex colours or named colours evident on the page"],
  "observed_tone": "the page's own voice in a few words",
  "brand_fit": "1-2 sentences: how this product aligns with or contrasts the Brand DNA/Tone below, and what to lean into for an on-brand ad",
  "suggested_brief": "a ready-to-run, on-brand campaign brief (2-3 sentences) the crew can take straight into a mission"
}
Use only facts present on the page — never invent features or numbers. Write in the brand's language (German if the brand is German). Output JSON only."""


def _strip_html(html: str) -> str:
    """Crude HTML → text: drop scripts/styles, unwrap tags, collapse space."""
    import re as _re

    html = _re.sub(r"(?is)<(script|style|noscript)[^>]*>.*?</\1>", " ", html)
    # keep title + meta description explicitly (often the cleanest summary)
    head_bits: list[str] = []
    m = _re.search(r"(?is)<title[^>]*>(.*?)</title>", html)
    if m:
        head_bits.append("TITLE: " + m.group(1).strip())
    for m in _re.finditer(r'(?is)<meta[^>]+(?:name|property)=["\'](?:description|og:description|og:title)["\'][^>]+content=["\']([^"\']+)["\']', html):
        head_bits.append("META: " + m.group(1).strip())
    # any hex colours present (helps observed_colors)
    colors = sorted(set(_re.findall(r"#[0-9a-fA-F]{6}", html)))[:12]
    body = _re.sub(r"(?s)<[^>]+>", " ", html)
    body = _re.sub(r"&[a-z]+;", " ", body)
    body = _re.sub(r"\s+", " ", body).strip()
    parts = head_bits + ([f"HEX COLOURS ON PAGE: {', '.join(colors)}"] if colors else []) + [body]
    return "\n".join(parts)[:8000]


def _intake_url_ok(url: str) -> bool:
    """Allow only public http(s) URLs — block SSRF to internal hosts."""
    from urllib.parse import urlparse

    try:
        u = urlparse(url)
    except ValueError:
        return False
    if u.scheme not in ("http", "https") or not u.hostname:
        return False
    host = u.hostname.lower()
    if host in ("localhost",) or host.endswith(".local") or host.endswith(".internal"):
        return False
    blocked_prefixes = ("127.", "10.", "192.168.", "169.254.", "0.")
    if host.startswith(blocked_prefixes):
        return False
    if host.startswith("172."):
        try:
            second = int(host.split(".")[1])
            if 16 <= second <= 31:
                return False
        except (ValueError, IndexError):
            return False
    return True


@router.post("/product-intake", response_model=APIResponse[ProductProfile])
async def product_intake(
    body: ProductIntakeRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[ProductProfile]:
    import httpx

    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    url = (body.url or "").strip()
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    if not _intake_url_ok(url):
        raise HTTPException(status_code=400, detail="invalid or disallowed URL")

    try:
        async with httpx.AsyncClient(timeout=20.0, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0 (BLAIQ product intake)"}) as client:
            r = await client.get(url)
            r.raise_for_status()
            html = r.text
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"could not fetch URL: {str(exc)[:200]}") from exc

    page_text = _strip_html(html)
    if len(page_text) < 40:
        raise HTTPException(status_code=422, detail="page had no extractable text")

    dna, tone = await _load_brand_md(db, tenant_id)
    prompt = (
        f"BRAND DNA (visual identity):\n{dna or '(none)'}\n\n"
        f"BRAND TONE (voice):\n{tone or '(confident, concise, professional)'}\n\n"
        f"PRODUCT PAGE URL: {url}\n\nPAGE CONTENT:\n{page_text}"
    )
    result = await chat(
        [{"role": "system", "content": _INTAKE_SYSTEM}, {"role": "user", "content": prompt}],
        max_tokens=1100, temperature=0.3,
    )
    if not result.get("ok"):
        raise HTTPException(status_code=503, detail=result.get("error") or "product intake unavailable")
    try:
        spec = _parse_briefing_json(result.get("text") or "")
    except (ValueError, TypeError):
        spec = {}

    return APIResponse(
        data=ProductProfile(
            url=url,
            product_name=str(spec.get("product_name") or "").strip(),
            one_liner=str(spec.get("one_liner") or "").strip(),
            value_props=[str(s).strip() for s in (spec.get("value_props") or []) if str(s).strip()][:6],
            audience=str(spec.get("audience") or "").strip(),
            observed_colors=[str(s).strip() for s in (spec.get("observed_colors") or []) if str(s).strip()][:12],
            observed_tone=str(spec.get("observed_tone") or "").strip(),
            brand_fit=str(spec.get("brand_fit") or "").strip(),
            suggested_brief=str(spec.get("suggested_brief") or "").strip(),
            model=result.get("model") or copilot_model(),
        ),
        message="ok",
    )


# ──────────────────────────────────────────────
# GenAI · Campaign orchestrator (Track B). One brief → a coordinated, on-brand
# campaign: concept + a brand-locked deck + multi-platform social copy + image/
# video briefs. Reuses the deck + social engines; Brand DNA/Tone govern all of
# it. Read-only on brand data; image/video render stays a separate explicit step.
# ──────────────────────────────────────────────

_CAMPAIGN_SYSTEM = """You are the campaign lead at the creative agency B&B Markenagentur.
From the brief + the Brand DNA/Tone below, design ONE coordinated campaign. Brand Tone governs every word; Brand DNA governs visual direction.

Respond with ONLY a JSON object:
{
  "headline": "the campaign's big headline",
  "big_idea": "one-sentence creative idea / through-line",
  "key_message": "the single message every asset must land",
  "channels": ["LinkedIn", "Instagram", "..."],
  "image_brief": "art-direction for the hero key visual — palette/typography/motif from the Brand DNA, the scene, mood (ready to feed an image model)",
  "video_brief": "a 1-2 sentence teaser concept for a short brand video, on-brand",
  "social": [ {"platform": "linkedin", "body": "ready-to-post copy", "hashtags": ["#one"]} ]
}
Rules: produce one social entry per requested platform, each in the right format + the brand's language (German if the brand is German). Output JSON only."""


async def _daemon_post(tenant_id: str, path: str, body: dict, timeout: float = 30.0) -> dict | None:
    """Trusted server-to-server POST to the Open Design daemon (verifyOpsTrust:
    X-Ops-Trust = HMAC(OPS_BRAIN_TRUST_TOKEN, '<tenant>:<ts>')). Used to create a
    real OD project + write campaign assets into it so Studio output lives in the
    same project/Artifacts system as MissionBuilder. Best-effort: returns None on
    failure so campaign generation still succeeds."""
    import hashlib
    import hmac
    import os
    import time

    import httpx

    base = os.environ.get("BLAIQ_DAEMON_URL", "http://open-design:7456").rstrip("/")
    token = os.environ.get("OPS_BRAIN_TRUST_TOKEN", "").strip()
    ts = str(int(time.time() * 1000))
    headers = {"Content-Type": "application/json", "X-Tenant-Id": tenant_id, "X-Ops-Trust-Ts": ts}
    if token:
        headers["X-Ops-Trust"] = hmac.new(
            token.encode("utf-8"), f"{tenant_id}:{ts}".encode("utf-8"), hashlib.sha256
        ).hexdigest()
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(base + path, json=body, headers=headers)
            if r.status_code >= 400:
                logger.warning("daemon POST %s -> %s %s", path, r.status_code, r.text[:200])
                return None
            return r.json()
    except Exception as exc:  # noqa: BLE001
        logger.warning("daemon POST %s failed: %s", path, exc)
        return None


def _campaign_markdown(spec: dict, social: list, video_brief: str, image_brief: str, job_number: str | None) -> str:
    lines = [
        f"# Campaign — {spec.get('headline') or ''}", "",
        f"**Big idea:** {spec.get('big_idea') or ''}", "",
        f"**Key message:** {spec.get('key_message') or ''}", "",
        f"**Channels:** {', '.join(str(c) for c in (spec.get('channels') or []))}", "",
    ]
    if job_number:
        lines += [f"**Linked job:** {job_number}", ""]
    lines += ["## Social posts", ""]
    for s in social:
        tags = " ".join(s.hashtags) if s.hashtags else ""
        lines += [f"### {s.platform}", "", s.body, "", tags, ""]
    lines += ["## Key visual — image brief", "", image_brief or "(none)", ""]
    lines += ["## Video — teaser brief", "", video_brief or "(none)", ""]
    lines += ["## Deck", "", "See `deck.html` in this project (brand-locked slides)."]
    return "\n".join(lines)


class CampaignRequest(BaseModel):
    brief: str
    platforms: list[str] = Field(default_factory=lambda: ["linkedin", "instagram"])
    deck: bool = True
    job_number: str | None = None   # optional: link the campaign to a POOOL job (Track C)
    create_project: bool = True     # create a real Open Design project + write assets
    render_image: bool = True       # also render the real key-visual image into the project


class CampaignResponse(BaseModel):
    headline: str
    big_idea: str
    key_message: str
    channels: list[str] = Field(default_factory=list)
    social: list[SocialArtifact] = Field(default_factory=list)
    image_brief: str = ""
    video_brief: str = ""
    deck_html: str | None = None
    deck_title: str | None = None
    deck_slides: int = 0
    od_project_id: str | None = None   # real Open Design project holding the assets
    od_project_url: str | None = None  # open in the OD workspace / Artifacts
    hero_image_path: str | None = None # rendered brand key-visual in the project
    job_number: str | None = None
    model: str


@router.post("/campaign", response_model=APIResponse[CampaignResponse])
async def generate_campaign(
    body: CampaignRequest,
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[CampaignResponse]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    if not body.brief.strip():
        raise HTTPException(status_code=400, detail="empty brief")

    dna, tone = await _load_brand_md(db, tenant_id)
    platforms = [p.lower().strip() for p in (body.platforms or ["linkedin", "instagram"])][:5]

    # 1) Campaign concept + social set + image/video briefs (one structured call).
    concept_prompt = (
        f"BRAND TONE:\n{tone or '(confident, concise)'}\n\n"
        f"BRAND DNA:\n{dna or '(none)'}\n\n"
        f"PLATFORMS: {', '.join(platforms)}\n\nCAMPAIGN BRIEF: {body.brief}"
    )
    res = await chat(
        [{"role": "system", "content": _CAMPAIGN_SYSTEM}, {"role": "user", "content": concept_prompt}],
        max_tokens=1600, temperature=0.5,
    )
    if not res.get("ok"):
        raise HTTPException(status_code=503, detail=res.get("error") or "campaign generation unavailable")
    try:
        spec = _parse_briefing_json(res.get("text") or "")
    except (ValueError, TypeError):
        raise HTTPException(status_code=502, detail="campaign model returned unparseable output")
    model_used = res.get("model") or copilot_model()

    social: list[SocialArtifact] = []
    for s in (spec.get("social") or []):
        if not isinstance(s, dict):
            continue
        plat = str(s.get("platform") or "").lower().strip() or "linkedin"
        text_body = str(s.get("body") or "").strip()
        tags = [str(h).strip() for h in (s.get("hashtags") or []) if str(h).strip()]
        social.append(SocialArtifact(
            platform=plat, title=str(spec.get("headline") or body.brief)[:80],
            body=text_body, hashtags=tags,
            share_url=_social_share_url(plat, text_body, tags),
            char_count=len(text_body), model=model_used,
        ))

    deck_html = deck_title = None
    deck_slides = 0
    if body.deck:
        # 2) Deck for the campaign (reuses the brand-locked deck engine).
        dprompt = (
            f"BRAND DNA (visual identity):\n{dna or '(minimal, elegant defaults)'}\n\n"
            f"BRAND TONE (voice):\n{tone or '(confident, concise)'}\n\n"
            f"TOPIC: {spec.get('headline') or body.brief}\n"
            f"Key message: {spec.get('key_message') or ''}\nMake exactly 5 content slides."
        )
        dres = await chat(
            [{"role": "system", "content": _DECK_SYSTEM}, {"role": "user", "content": dprompt}],
            max_tokens=1500, temperature=0.4,
        )
        if dres.get("ok"):
            try:
                dspec = _parse_briefing_json(dres.get("text") or "")
                if isinstance(dspec, dict):
                    deck_html = _render_deck_html(dspec)
                    deck_title = str(dspec.get("title") or spec.get("headline") or body.brief)
                    deck_slides = len(dspec.get("slides") or [])
            except (ValueError, TypeError):
                pass

    image_brief = str(spec.get("image_brief") or "").strip()
    video_brief = str(spec.get("video_brief") or "").strip()

    # Unify with Open Design: create a real OD project and write the campaign
    # assets into it (deck.html + campaign.md), so Studio output lands in the
    # same project/Artifacts system as MissionBuilder — one system, not two.
    od_project_id = od_project_url = od_hero_image_path = None
    if body.create_project:
        import uuid as _uuid
        pid = f"campaign-{_uuid.uuid4().hex[:10]}"
        name = (str(spec.get("headline") or body.brief)[:80]) or "Campaign"
        meta = {"kind": "campaign", "source": "campaign-orchestrator"}
        if body.job_number:
            meta["jobNumber"] = body.job_number
        proj = await _daemon_post(tenant_id, "/api/projects", {"id": pid, "name": name, "metadata": meta})
        if proj:
            od_project_id = pid
            od_project_url = f"/projects/{pid}"
            md = _campaign_markdown(spec, social, video_brief, image_brief, body.job_number)
            await _daemon_post(tenant_id, f"/api/projects/{pid}/files", {"name": "campaign.md", "content": md})
            if deck_html:
                await _daemon_post(tenant_id, f"/api/projects/{pid}/files", {"name": "deck.html", "content": deck_html})
            # Render the real brand key-visual into the same project (the daemon's
            # image pipeline re-enriches the brief with Brand DNA+Tone+Hivemind).
            if body.render_image and image_brief:
                img = await _daemon_post(
                    tenant_id, "/api/v1/image/render",
                    {"project_id": pid, "prompt": image_brief, "aspect": "16:9"},
                    timeout=90.0,
                )
                if img and img.get("file_path"):
                    od_hero_image_path = img["file_path"]

    return APIResponse(
        data=CampaignResponse(
            headline=str(spec.get("headline") or "").strip() or body.brief,
            big_idea=str(spec.get("big_idea") or "").strip(),
            key_message=str(spec.get("key_message") or "").strip(),
            channels=[str(c) for c in (spec.get("channels") or [])],
            social=social,
            image_brief=image_brief,
            video_brief=video_brief,
            deck_html=deck_html, deck_title=deck_title, deck_slides=deck_slides,
            od_project_id=od_project_id, od_project_url=od_project_url,
            hero_image_path=od_hero_image_path,
            job_number=body.job_number,
            model=model_used,
        ),
        message="ok",
    )


# ──────────────────────────────────────────────
# Admin · Clients rollup. Per-client view of the agency's book (read-only):
# jobs, quoted/invoiced/paid, overdue, last activity. An agency runs on clients;
# this groups the live jobs by client so the PM sees each relationship at a glance.
# ──────────────────────────────────────────────

class ClientRollup(BaseModel):
    client: str
    jobs: int
    quoted: float
    invoiced: float
    paid: float
    overdue_count: int
    overdue_amount: float
    last_activity: str | None = None


@router.get("/clients", response_model=APIResponse[list[ClientRollup]])
async def clients_rollup(
    db: AsyncSession = Depends(_get_db),
) -> APIResponse[list[ClientRollup]]:
    tenant_id = current_tenant_id.get("")
    if not tenant_id:
        raise HTTPException(status_code=401, detail="missing tenant")
    rows = (
        await db.execute(
            text(
                "SELECT client, count(*), "
                "COALESCE(sum(quote_amount),0), COALESCE(sum(invoice_amount),0), "
                "COALESCE(sum(invoice_amount) FILTER (WHERE poool_status='paid'),0), "
                "count(*) FILTER (WHERE poool_status IN ('invoiced','partially_paid','overdue') "
                "  AND payment_due_date IS NOT NULL AND payment_due_date < CURRENT_DATE), "
                "COALESCE(sum(COALESCE(invoice_amount,quote_amount)) FILTER (WHERE "
                "  poool_status IN ('invoiced','partially_paid','overdue') "
                "  AND payment_due_date IS NOT NULL AND payment_due_date < CURRENT_DATE),0), "
                "max(created_at) "
                "FROM ops.jobs WHERE tenant_id = CAST(:tid AS uuid) "
                "AND client IS NOT NULL AND client <> '' "
                "GROUP BY client ORDER BY 3 DESC"
            ),
            {"tid": tenant_id},
        )
    ).all()
    out = [
        ClientRollup(
            client=r[0], jobs=int(r[1]),
            quoted=float(r[2] or 0), invoiced=float(r[3] or 0), paid=float(r[4] or 0),
            overdue_count=int(r[5] or 0), overdue_amount=float(r[6] or 0),
            last_activity=r[7].isoformat() if r[7] else None,
        )
        for r in rows
    ]
    return APIResponse(data=out, message="ok")
