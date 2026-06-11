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

import json
import logging
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import text

from aiteam.storage.connection import current_tenant_id, get_session

logger = logging.getLogger(__name__)


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
    """POST a JSON-RPC 2.0 envelope to the Poool MCP, handling SSE replies.

    Returns the decoded JSON-RPC response dict; on transport error returns
    ``{"error": {"message": ...}}`` so callers can branch uniformly.
    """
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(url, json=payload, headers=headers)
        body = resp.text
    except httpx.HTTPError as exc:
        return {"error": {"message": str(exc)}}
    try:
        return json.loads(body)
    except json.JSONDecodeError:
        # SSE envelope — extract first `data:` line
        for line in body.splitlines():
            stripped = line.strip()
            if stripped.startswith("data:"):
                fragment = stripped[len("data:"):].strip()
                try:
                    return json.loads(fragment)
                except json.JSONDecodeError:
                    continue
        return {"error": {"message": body[:200]}}


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
        "model": "project.project",
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
    counts = {"timetrack": 0, "order": 0, "invoice": 0}
    token = current_tenant_id.set(tenant_id)
    try:
        brand = await _load_brand(tenant_id)
        if brand is None or not brand.poool_enabled:
            return counts
        for kind, model in (
            ("timetrack", "account.analytic.line"),
            ("order", "sale.order"),
            ("invoice", "account.move"),
        ):
            resp = await _call_tool(
                brand,
                "poool_api_list",
                {"model": model, "limit": 200},
            )
            records = _extract_records(resp)
            for record in records:
                ext = str(record.get("id")) if record.get("id") is not None else None
                project_ext = None
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


def _extract_records(resp: dict[str, Any]) -> list[dict[str, Any]]:
    """Pull a list of records out of a Poool tools/call response."""
    result = resp.get("result", {})
    structured = result.get("structuredContent") or {}
    if isinstance(structured, dict):
        records = structured.get("records") or structured.get("items")
        if isinstance(records, list):
            return [r for r in records if isinstance(r, dict)]
    for chunk in result.get("content", []) or []:
        if chunk.get("type") == "text" and isinstance(chunk.get("text"), str):
            try:
                parsed = json.loads(chunk["text"])
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, list):
                return [r for r in parsed if isinstance(r, dict)]
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
