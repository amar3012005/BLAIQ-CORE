"""Server-folder automation (Track A5).

Thin wrapper over the daemon's /api/v1/org/server/* routes, which own the
filesystem (the delivery-folder volume). Reuses the ClickUp DaemonEndpoint so
the server-to-server call carries the ops-brain trust headers.
"""

from __future__ import annotations

import logging
from typing import Any

from aiteam.integrations.clickup import DaemonEndpoint, _post_json

logger = logging.getLogger(__name__)


async def create_job_folder(
    tenant_id: str,
    *,
    client: str,
    job_number: str,
    user_id: str = "",
) -> dict[str, Any]:
    """Ask the daemon to create the job's delivery folder.

    Returns ``{"ok": bool, "path": str|None, "error": str|None}``.
    """
    endpoint = DaemonEndpoint.from_env(tenant_id, user_id=user_id)
    resp = await _post_json(
        endpoint,
        "/api/v1/org/server/folder",
        {"client": client, "job_number": job_number},
    )
    if not resp or not resp.get("ok") or not resp.get("path"):
        return {
            "ok": False,
            "path": None,
            "error": (resp or {}).get("error") or "server folder create failed",
        }
    return {"ok": True, "path": str(resp["path"]), "error": None}
