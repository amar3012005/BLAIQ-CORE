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
