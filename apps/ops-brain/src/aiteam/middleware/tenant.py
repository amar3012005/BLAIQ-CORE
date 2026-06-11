"""Tenant scoping middleware for the BLAIQ-unified Ops Brain sidecar.

The BLAIQ daemon (`apps/daemon/src/admin/admin-routes.ts`) authenticates
the user, then forwards the request to this sidecar with:

  X-Tenant-Id: <uuid v4>          — REQUIRED; the authenticated tenant.
  X-Ops-Trust: <hex hmac>         — OPTIONAL; HMAC-SHA256 of the tenant id
                                    using OPS_BRAIN_TRUST_TOKEN. When the
                                    env var is set on the sidecar, this
                                    header is required and verified.

The middleware:
  1. Lets unauthenticated infra paths through (/api/health, /docs, ...).
  2. Validates the tenant header shape and trust signature.
  3. Binds `current_tenant_id` for the request so
     `aiteam.storage.connection.get_session()` issues
     `SET LOCAL app.tenant_id = ...` on every DB checkout, satisfying
     the RLS policies defined in migrations 006 and 008.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import re

from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from aiteam.storage.connection import current_tenant_id

logger = logging.getLogger(__name__)

# Paths that must not require a tenant (health, docs, openapi schema,
# static MCP transport, favicon). Everything else under /api/* requires
# X-Tenant-Id.
_UNAUTHENTICATED_PATHS = frozenset(
    {"/api/health", "/docs", "/openapi.json", "/redoc", "/favicon.ico"}
)
_UNAUTHENTICATED_PREFIXES: tuple[str, ...] = ("/mcp", "/assets", "/static")

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)


def _is_uuid(value: str) -> bool:
    return bool(_UUID_RE.match(value))


def _is_unauthenticated_path(path: str) -> bool:
    if path in _UNAUTHENTICATED_PATHS:
        return True
    return any(path.startswith(prefix) for prefix in _UNAUTHENTICATED_PREFIXES)


class TenantMiddleware(BaseHTTPMiddleware):
    """Enforce per-request tenant binding for ops.* DB access."""

    def __init__(self, app: object, trust_token_env: str = "OPS_BRAIN_TRUST_TOKEN") -> None:
        super().__init__(app)  # type: ignore[arg-type]
        self._trust_token_env = trust_token_env

    async def dispatch(
        self, request: Request, call_next: RequestResponseEndpoint
    ) -> Response:
        path = request.url.path
        if _is_unauthenticated_path(path):
            return await call_next(request)

        tenant_header = request.headers.get("X-Tenant-Id", "").strip()
        if not tenant_header:
            return JSONResponse(
                {"error": "missing_tenant", "detail": "X-Tenant-Id header required"},
                status_code=401,
            )
        if not _is_uuid(tenant_header):
            return JSONResponse(
                {"error": "invalid_tenant", "detail": "X-Tenant-Id must be a UUID"},
                status_code=400,
            )

        trust_token = os.environ.get(self._trust_token_env, "").strip()
        if trust_token:
            provided = request.headers.get("X-Ops-Trust", "").strip()
            expected = hmac.new(
                trust_token.encode("utf-8"),
                tenant_header.encode("utf-8"),
                hashlib.sha256,
            ).hexdigest()
            if not provided or not hmac.compare_digest(provided, expected):
                logger.warning("TenantMiddleware: invalid X-Ops-Trust for %s", tenant_header)
                return JSONResponse(
                    {"error": "untrusted_caller", "detail": "X-Ops-Trust mismatch"},
                    status_code=401,
                )

        token = current_tenant_id.set(tenant_header)
        try:
            return await call_next(request)
        finally:
            current_tenant_id.reset(token)
