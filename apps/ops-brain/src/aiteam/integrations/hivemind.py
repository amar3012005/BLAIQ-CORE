"""Hivemind MCP client for Ops Brain.

Async wrapper around the project-scoped Hivemind JSON-RPC API used by the
BLAIQ daemon. The same tool names are used here so a single Hivemind
server backs both the daemon and the Ops Brain.
"""

from __future__ import annotations

import itertools
import logging
from dataclasses import dataclass
from typing import Any

import httpx

logger = logging.getLogger(__name__)

_REQUEST_TIMEOUT_S = 15.0
_id_counter = itertools.count(1)


@dataclass(frozen=True)
class TenantBrandConfig:
    """Subset of brand config the Hivemind client needs."""

    hivemind_url: str
    hivemind_api_key: str


class HivemindClient:
    """Async wrapper for project-scoped Hivemind calls."""

    def __init__(self, brand: TenantBrandConfig) -> None:
        self._brand = brand

    @property
    def configured(self) -> bool:
        return bool(self._brand.hivemind_url and self._brand.hivemind_api_key)

    async def _call_tool(self, name: str, arguments: dict[str, Any]) -> str:
        """Invoke a Hivemind tool and return concatenated text content.

        Failures are non-fatal: log and return an empty string so the agent
        prompt remains usable.
        """
        if not self.configured:
            return ""
        body = {
            "jsonrpc": "2.0",
            "id": next(_id_counter),
            "method": "tools/call",
            "params": {"name": name, "arguments": arguments},
        }
        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Authorization": f"Bearer {self._brand.hivemind_api_key}",
        }
        try:
            async with httpx.AsyncClient(timeout=_REQUEST_TIMEOUT_S) as client:
                resp = await client.post(
                    self._brand.hivemind_url, json=body, headers=headers
                )
        except httpx.HTTPError as exc:
            logger.warning("hivemind %s transport failure: %s", name, exc)
            return ""

        text = resp.text or ""
        payload: dict[str, Any] | None = None
        try:
            payload = resp.json()
        except ValueError:
            for line in text.splitlines():
                if line.startswith("data:"):
                    try:
                        import json

                        payload = json.loads(line[5:].strip())
                        break
                    except ValueError:
                        continue
        if not payload:
            logger.warning("hivemind %s unparseable response", name)
            return ""
        if "error" in payload and payload["error"]:
            logger.warning(
                "hivemind %s error: %s", name, payload["error"].get("message")
            )
            return ""
        result = payload.get("result") or {}
        content = result.get("content") or []
        parts: list[str] = []
        for chunk in content:
            if chunk.get("type") == "text" and isinstance(chunk.get("text"), str):
                parts.append(chunk["text"])
        return "\n\n".join(parts).strip()

    async def save_project_brief(self, project_id: str, brief: str) -> bool:
        """Persist a project brief so future recall calls can surface it."""
        if not brief.strip():
            return False
        text = await self._call_tool(
            "hivemind_save_memory",
            {
                "content": brief,
                "project_id": project_id,
                "memory_type": "project_brief",
                "tags": ["ops-brain", "project_brief"],
                "title": f"Project brief: {project_id}",
            },
        )
        return bool(text) or self.configured

    async def save_meeting_decision(
        self, project_id: str, meeting_id: str, summary: str
    ) -> bool:
        """Persist a meeting decision summary scoped to the project."""
        if not summary.strip():
            return False
        await self._call_tool(
            "hivemind_save_memory",
            {
                "content": summary,
                "project_id": project_id,
                "memory_type": "meeting_decision",
                "tags": ["ops-brain", "meeting_decision", meeting_id],
                "title": f"Meeting {meeting_id} decision",
            },
        )
        return True

    async def recall_for_task(
        self, project_id: str, query: str, limit: int = 6
    ) -> str:
        """Return memory text suitable for direct injection into an agent prompt."""
        if not query.strip():
            return ""
        return await self._call_tool(
            "hivemind_recall",
            {"query": query, "limit": limit, "project_id": project_id},
        )
