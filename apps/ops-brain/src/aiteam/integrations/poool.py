"""Poool ERP integration — pulls timetrack, orders, invoices from a tenant's
Poool MCP gateway and caches them in ``ops.poool_cache`` for project margin
analytics.

The MCP endpoint + API key live on ``tenant_brand`` (poool_url,
poool_api_key, poool_enabled) and are written by the BLAIQ web Org →
Brand → Poool tab. Sync runs are scheduled per-tenant by the Track D
scheduler; this module exposes the building blocks.

JSON-RPC envelope mirrors apps/daemon/src/erp/poool-client.ts:
``tools/call`` with ``name=poool_api_search|poool_api_read|poool_api_list``
for OCA-style ORM, plus Prism BSL ``query_model`` for analytics.
"""

from __future__ import annotations

import asyncio
import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import text

from aiteam.storage.connection import current_tenant_id, get_session

logger = logging.getLogger(__name__)

_DEFAULT_SYNC_INTERVAL_S = 1800.0


@dataclass(frozen=True)
class TenantBrand:
    """Subset of tenant_brand needed for Poool calls."""

    tenant_id: str
    poool_url: str
    poool_api_key: str
    poool_enabled: bool


@dataclass(frozen=True)
class ProjectMargin:
    project_id: str
    revenue: float
    cost: float
    llm_cost: float
    margin: float


async def _call_mcp(
    url: str,
    api_key: str,
    method: str,
    params: dict[str, Any],
    *,
    timeout: float = 30.0,
) -> dict[str, Any]:
    """Call a Poool MCP method, performing the full streamable-HTTP handshake.

    The Poool Unified Data Server is a stateful MCP: it requires
    initialize → (mcp-session-id) → notifications/initialized before any
    tools/call. We run that handshake per call (cheap enough for a 30-min
    poller) and parse the SSE ``data:`` reply. On transport error returns
    ``{"error": {"message": ...}}`` so callers branch uniformly.
    """
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    def _parse(body: str) -> dict[str, Any] | None:
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            for line in body.splitlines():
                stripped = line.strip()
                if stripped.startswith("data:"):
                    try:
                        return json.loads(stripped[len("data:"):].strip())
                    except json.JSONDecodeError:
                        continue
        return None

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            # 1. initialize — capture the session id the server mints.
            init = await client.post(
                url,
                headers=headers,
                json={
                    "jsonrpc": "2.0", "id": 0, "method": "initialize",
                    "params": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {},
                        "clientInfo": {"name": "blaiq-ops-brain", "version": "1"},
                    },
                },
            )
            session_headers = dict(headers)
            sid = init.headers.get("mcp-session-id")
            if sid:
                session_headers["mcp-session-id"] = sid
            # 2. initialized notification (required before tool calls).
            try:
                await client.post(
                    url, headers=session_headers,
                    json={"jsonrpc": "2.0", "method": "notifications/initialized"},
                )
            except httpx.HTTPError:
                pass
            # 3. the actual call, on the established session.
            resp = await client.post(
                url, headers=session_headers,
                json={"jsonrpc": "2.0", "id": 1, "method": method, "params": params},
            )
    except httpx.HTTPError as exc:
        return {"error": {"message": str(exc)}}
    parsed = _parse(resp.text)
    return parsed if parsed is not None else {"error": {"message": resp.text[:200]}}


async def _call_tool(
    brand: TenantBrand,
    name: str,
    args: dict[str, Any],
) -> dict[str, Any]:
    resp = await _call_mcp(
        brand.poool_url,
        brand.poool_api_key,
        "tools/call",
        {"name": name, "arguments": args},
    )
    if "error" in resp:
        logger.warning("poool mcp error (%s): %s", name, resp["error"].get("message"))
    return resp


async def fetch_poool_project(
    brand: TenantBrand,
    project_name: str,
) -> dict[str, Any] | None:
    """Look up a Poool project by exact name. Returns the first match."""
    args = {
        "model_name": "project.project",
        "filters": [["name", "=", project_name]],
        "limit": 1,
    }
    resp = await _call_tool(brand, "poool_api_search", args)
    result = resp.get("result", {})
    structured = result.get("structuredContent") or {}
    records: list[dict[str, Any]] = []
    if isinstance(structured, dict):
        records = list(structured.get("records") or [])
    if records:
        return records[0]
    # Fall back to parsing the text content block as JSON.
    for chunk in result.get("content", []) or []:
        if chunk.get("type") == "text" and isinstance(chunk.get("text"), str):
            try:
                parsed = json.loads(chunk["text"])
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, list) and parsed:
                return parsed[0] if isinstance(parsed[0], dict) else None
            if isinstance(parsed, dict):
                return parsed
    return None


async def _upsert_cache(
    tenant_id: str,
    kind: str,
    project_external_id: str | None,
    external_id: str | None,
    payload: dict[str, Any],
) -> None:
    """Insert/update a cache row, scoped to the current tenant via RLS."""
    async with get_session() as session:
        await session.execute(
            text(
                """
                INSERT INTO ops.poool_cache
                    (tenant_id, kind, project_external_id, external_id, payload, fetched_at)
                VALUES
                    (:tenant_id, :kind, :project_external_id, :external_id, CAST(:payload AS jsonb), now())
                ON CONFLICT (tenant_id, kind, external_id)
                WHERE external_id IS NOT NULL
                DO UPDATE SET payload = EXCLUDED.payload,
                              project_external_id = EXCLUDED.project_external_id,
                              fetched_at = now()
                """
            ),
            {
                "tenant_id": tenant_id,
                "kind": kind,
                "project_external_id": project_external_id,
                "external_id": external_id,
                "payload": json.dumps(payload),
            },
        )


async def sync_tenant_poool(tenant_id: str) -> dict[str, int]:
    """Pull timetrack_times, orders, and invoices for the tenant's projects.

    Returns a count summary so the scheduler can log/emit metrics. Assumes
    the caller has already set ``current_tenant_id`` for RLS-bound writes.
    """
    # Model names for the Poool Unified Data Server (v3.x). Discover via
    # poool_api_list_models — this instance exposes clients/companies/
    # cost_centers/orders/persons/projects.
    counts = {"project": 0, "order": 0, "client": 0}
    token = current_tenant_id.set(tenant_id)
    try:
        brand = await _load_brand(tenant_id)
        if brand is None or not brand.poool_enabled:
            return counts
        for kind, model in (
            ("project", "projects"),
            ("order", "orders"),
            ("client", "clients"),
        ):
            resp = await _call_tool(
                brand,
                "poool_api_list",
                {"model_name": model, "limit": 200},
            )
            records = _extract_records(resp)
            for record in records:
                ext = str(record.get("id")) if record.get("id") is not None else None
                # An order references its project; a project is its own anchor.
                project_ext = None
                if kind == "project":
                    project_ext = ext
                else:
                    project = record.get("project_id")
                    if isinstance(project, list) and project:
                        project_ext = str(project[0])
                    elif isinstance(project, (int, str)):
                        project_ext = str(project)
                await _upsert_cache(tenant_id, kind, project_ext, ext, record)
                counts[kind] += 1
    finally:
        current_tenant_id.reset(token)
    return counts


def _salvage_objects(s: str) -> list[dict[str, Any]]:
    """Extract complete top-level {...} objects from a (possibly truncated)
    JSON array string. Poool caps responses at ~25 KB and cuts mid-record;
    this recovers every record that fully arrived and drops the partial tail.
    """
    start = s.find("[")
    if start < 0:
        return []
    rows: list[dict[str, Any]] = []
    depth = 0
    in_str = False
    esc = False
    obj_start = -1
    for i in range(start + 1, len(s)):
        c = s[i]
        if in_str:
            if esc:
                esc = False
            elif c == "\\":
                esc = True
            elif c == '"':
                in_str = False
            continue
        if c == '"':
            in_str = True
        elif c == "{":
            if depth == 0:
                obj_start = i
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0 and obj_start >= 0:
                frag = s[obj_start:i + 1]
                try:
                    rows.append(json.loads(frag, strict=False))
                except json.JSONDecodeError:
                    pass
                obj_start = -1
    return rows


def _coerce_rows(obj: Any) -> list[dict[str, Any]] | None:
    """Recursively pull a list of record dicts out of a Poool payload.

    Poool v3 double-wraps: structuredContent = {"result": "<json string of
    {\"data\": [...]}>"}. We accept a dict, a list, or a JSON string and dig
    through data / records / items / result until we hit the row list. If the
    string is truncated (server 25 KB cap), salvage the complete records.
    """
    if isinstance(obj, str):
        try:
            obj = json.loads(obj, strict=False)
        except json.JSONDecodeError:
            salvaged = _salvage_objects(obj)
            return salvaged or None
    if isinstance(obj, list):
        return [r for r in obj if isinstance(r, dict)]
    if isinstance(obj, dict):
        for key in ("data", "records", "items", "result"):
            if obj.get(key) is not None:
                rows = _coerce_rows(obj[key])
                if rows:
                    return rows
    return None


def _extract_records(resp: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull a list of records out of a Poool tools/call response."""
    result = resp.get("result", {})
    rows = _coerce_rows(result.get("structuredContent"))
    if rows:
        return rows
    for chunk in result.get("content", []) or []:
        if chunk.get("type") == "text" and isinstance(chunk.get("text"), str):
            rows = _coerce_rows(chunk["text"])
            if rows:
                return rows
    return []


async def _load_brand(tenant_id: str) -> TenantBrand | None:
    """Read the tenant's Poool config from ``tenant_brand``."""
    async with get_session() as session:
        row = (
            await session.execute(
                text(
                    "SELECT poool_url, poool_api_key, poool_enabled "
                    "FROM tenant_brand WHERE tenant_id = CAST(:tid AS uuid)"
                ),
                {"tid": tenant_id},
            )
        ).first()
    if row is None:
        return None
    return TenantBrand(
        tenant_id=tenant_id,
        poool_url=row[0] or "",
        poool_api_key=row[1] or "",
        poool_enabled=bool(row[2]),
    )


async def compute_project_margin(project_id: str) -> ProjectMargin:
    """Aggregate revenue/cost from cached Poool data + LLM spend for the tenant.

    Caller must have ``current_tenant_id`` set (RLS scopes both
    ``ops.poool_cache`` and ``ops.agent_activities``).
    """
    revenue = 0.0
    cost = 0.0
    llm_cost = 0.0
    async with get_session() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT kind, payload FROM ops.poool_cache "
                    "WHERE project_external_id = :pid"
                ),
                {"pid": project_id},
            )
        ).all()
        for kind, payload in rows:
            data = payload if isinstance(payload, dict) else {}
            if kind == "invoice":
                amount = _as_float(data.get("amount_total"))
                revenue += amount
            elif kind == "timetrack":
                hours = _as_float(data.get("unit_amount"))
                rate = _as_float(data.get("amount")) or _as_float(data.get("rate"))
                cost += hours * rate if rate else _as_float(data.get("amount"))
        llm_row = (
            await session.execute(
                text(
                    "SELECT COALESCE(SUM(cost_usd), 0)::float FROM ops.agent_activities "
                    "WHERE project_external_id = :pid"
                ),
                {"pid": project_id},
            )
        ).scalar_one_or_none()
        if llm_row is not None:
            llm_cost = float(llm_row)
    margin = revenue - cost - llm_cost
    return ProjectMargin(
        project_id=project_id,
        revenue=revenue,
        cost=cost,
        llm_cost=llm_cost,
        margin=margin,
    )


def _as_float(value: Any) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value)
        except ValueError:
            return 0.0
    return 0.0


async def create_poool_quote(
    tenant_id: str,
    *,
    project_name: str,
    amount: float | None,
    client_name: str = "",
) -> dict[str, Any]:
    """Create a POOOL project + quote (sale.order) for a job. Credential-ready.

    Returns ``{"ok": bool, "poool_job_id": str|None, "error": str|None}``.
    Degrades gracefully: if the tenant has not enabled/configured POOOL the
    call is a clean no-op with ``ok=False`` and a human-readable error, so the
    "Push to POOOL" button can show a sensible message until POOOL is wired.
    """
    brand = await _load_brand(tenant_id)
    if brand is None or not brand.poool_enabled:
        return {"ok": False, "poool_job_id": None, "error": "POOOL not enabled — connect it in Settings"}
    # Note: the Poool MCP holds its own credentials, so no per-tenant api key is
    # required here — reachability + enabled is enough.
    # 1. Create the project.
    proj = await _call_tool(
        brand,
        "poool_api_create",
        {"model_name": "projects", "data": {"name": project_name}},
    )
    if "error" in proj:
        return {"ok": False, "poool_job_id": None, "error": str(proj["error"].get("message"))}
    project_id = _first_created_id(proj)
    # 2. Create the quote (draft sale.order) referencing the project.
    order_values: dict[str, Any] = {"title": project_name}
    if project_id is not None:
        order_values["project_id"] = project_id
    order = await _call_tool(
        brand,
        "poool_api_create",
        {"model_name": "orders", "data": order_values},
    )
    if "error" in order:
        return {"ok": False, "poool_job_id": str(project_id) if project_id else None,
                "error": str(order["error"].get("message"))}
    order_id = _first_created_id(order)
    poool_job_id = str(order_id or project_id or "")
    return {"ok": bool(poool_job_id), "poool_job_id": poool_job_id or None, "error": None}


def _first_created_id(resp: dict[str, Any]) -> Any:
    """Pull the new record id out of a poool_api_create response."""
    result = resp.get("result", {})
    structured = result.get("structuredContent") or {}
    if isinstance(structured, dict):
        for key in ("id", "record_id"):
            if structured.get(key) is not None:
                return structured[key]
        records = structured.get("records")
        if isinstance(records, list) and records and isinstance(records[0], dict):
            return records[0].get("id")
    for chunk in result.get("content", []) or []:
        if chunk.get("type") == "text" and isinstance(chunk.get("text"), str):
            try:
                parsed = json.loads(chunk["text"])
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and parsed.get("id") is not None:
                return parsed["id"]
            if isinstance(parsed, list) and parsed and isinstance(parsed[0], dict):
                return parsed[0].get("id")
    return None


async def run_payment_check(tenant_id: str) -> int:
    """Flip invoiced/partially-paid jobs whose payment due date has passed to
    ``overdue``. Pure local DB (no POOOL needed) — implements the 14/30-day
    rule purely from ``payment_due_date``. Returns the number of jobs flipped.
    """
    _PREDICATE = (
        "poool_status IN ('invoiced', 'partially_paid') "
        "AND payment_due_date IS NOT NULL AND payment_due_date < CURRENT_DATE"
    )
    token = current_tenant_id.set(tenant_id)
    try:
        async with get_session() as session:
            rows = (
                await session.execute(
                    text(
                        f"SELECT id, job_number, client FROM ops.jobs "
                        f"WHERE tenant_id = CAST(:tid AS uuid) AND {_PREDICATE}"
                    ),
                    {"tid": tenant_id},
                )
            ).all()
            if not rows:
                return 0
            await session.execute(
                text(
                    f"UPDATE ops.jobs SET poool_status = 'overdue', updated_at = now() "
                    f"WHERE tenant_id = CAST(:tid AS uuid) AND {_PREDICATE}"
                ),
                {"tid": tenant_id},
            )
    finally:
        current_tenant_id.reset(token)

    # Raise an overdue reminder per flipped job (Track A6). Best-effort.
    try:
        from aiteam.integrations.job_notifications import record_notification

        for r in rows:
            await record_notification(
                tenant_id,
                kind="payment_overdue",
                job_id=str(r[0]),
                subject=f"Zahlung überfällig — {r[1]} {r[2]}",
                body=f"Invoice for job {r[1]} ({r[2]}) is past its due date.",
            )
    except Exception:
        logger.warning("overdue notifications failed (tenant=%s)", tenant_id, exc_info=True)

    return len(rows)


async def poll_payment_check(
    tenant_id: str,
    *,
    interval_s: float = 86_400.0,
) -> None:
    """Always-on daily payment-overdue sweep (independent of POOOL connectivity).

    Runs once immediately on tenant activation, then every ``interval_s``.
    """
    logger.info("Payment-check poller started: tenant=%s every %.0fs", tenant_id, interval_s)
    while True:
        try:
            flipped = await run_payment_check(tenant_id)
            if flipped:
                logger.info("Payment check flipped %d job(s) to overdue (tenant=%s)", flipped, tenant_id)
        except asyncio.CancelledError:
            logger.info("Payment-check poller cancelled: tenant=%s", tenant_id)
            raise
        except Exception:
            logger.exception("Payment check failed for tenant=%s", tenant_id)
        try:
            await asyncio.sleep(interval_s)
        except asyncio.CancelledError:
            raise


async def poll_poool(
    tenant_id: str,
    *,
    interval_s: float = _DEFAULT_SYNC_INTERVAL_S,
) -> None:
    """Long-running per-tenant POOOL cache sync.

    Hosted by the Track D tenant scheduler (see aiteam.api.deps), mirroring
    the ClickUp poller. ``sync_tenant_poool`` is a no-op when the tenant has
    not enabled POOOL (``tenant_brand.poool_enabled = false``) or has no
    credentials, so this loop stays quiet until the PM configures POOOL in
    the admin Settings. Cancel the task to stop it during tenant eviction.
    """
    logger.info("POOOL sync poller started: tenant=%s every %.0fs", tenant_id, interval_s)
    while True:
        try:
            counts = await sync_tenant_poool(tenant_id)
            if any(counts.values()):
                logger.info(
                    "POOOL sync upserted %s for tenant=%s", counts, tenant_id
                )
        except asyncio.CancelledError:
            logger.info("POOOL poller cancelled: tenant=%s", tenant_id)
            raise
        except Exception:
            logger.exception("POOOL sync failed for tenant=%s", tenant_id)
        try:
            await asyncio.sleep(interval_s)
        except asyncio.CancelledError:
            logger.info("POOOL poller cancelled during sleep: tenant=%s", tenant_id)
            raise
