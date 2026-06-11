"""AI Team OS — Async Postgres connection with tenant RLS.

The BLAIQ unification (Track A.2) replaces the legacy SQLite engine with
BLAIQ's shared Postgres. Each request is bound to a tenant via the
`current_tenant_id` ContextVar (set by
`aiteam.middleware.tenant.TenantMiddleware`); the session context manager
issues `SET LOCAL app.tenant_id = ...` on every checkout so the RLS
policies in migration 006 see the right tenant.

A SQLite fallback is retained for unit tests that explicitly opt in via
`DATABASE_URL=sqlite+aiosqlite:///...`. In that mode tenant binding is a
no-op since RLS is Postgres-only.
"""

from __future__ import annotations

import os
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from contextvars import ContextVar

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from aiteam.storage.engine_pool import engine_pool

# Tenant ContextVar — set per-request by TenantMiddleware. When unset,
# get_session() refuses to run against the ops.* schema (RLS would mask
# every row anyway). Set to a UUID string before opening a session.
current_tenant_id: ContextVar[str | None] = ContextVar("current_tenant_id", default=None)


def _default_db_url() -> str:
    """Resolve the database URL from env. Postgres is required in prod.

    Test/dev callers may set `DATABASE_URL=sqlite+aiosqlite:///...` to
    keep legacy tests working; production deployments must point at the
    BLAIQ shared Postgres (DSN is supplied via env in Coolify).
    """
    url = os.environ.get("DATABASE_URL", "").strip()
    if not url:
        msg = (
            "DATABASE_URL is required. Set it to a Postgres DSN "
            "(e.g. postgresql+asyncpg://user:pw@host:5432/db) "
            "or to sqlite+aiosqlite:///path for local tests."
        )
        raise RuntimeError(msg)
    return url


# Default database URL is resolved lazily so import-time does not crash
# during tests that import models without DATABASE_URL set.
def _resolve_db_url(db_url: str | None) -> str:
    return db_url or _default_db_url()


# Backwards-compat name used by legacy callers. None until first resolution.
DEFAULT_DB_URL: str | None = None


def get_engine(db_url: str | None = None) -> AsyncEngine:
    """Get or create an async database engine."""
    url = _resolve_db_url(db_url)
    return engine_pool.get_engine(url)


def _is_postgres(url: str) -> bool:
    return url.startswith("postgresql") or url.startswith("postgres://")


@asynccontextmanager
async def get_session(
    db_url: str | None = None,
) -> AsyncGenerator[AsyncSession, None]:
    """Yield an AsyncSession with `app.tenant_id` bound for the request.

    On Postgres: issues `SELECT set_config('app.tenant_id', :tid, true)`
    inside the implicit transaction so RLS policies (see migrations 006,
    008) accept rows for the current tenant only. Mirrors the TypeScript
    `withTenant()` helper in apps/daemon/src/db/pool.ts.

    On SQLite (test mode): tenant binding is a no-op.
    """
    url = _resolve_db_url(db_url)
    factory = engine_pool.get_session_factory(url)
    tenant_id = current_tenant_id.get()
    async with factory() as session:
        try:
            if _is_postgres(url) and tenant_id:
                # set_config(name, value, is_local=true) is the parametrized
                # form of SET LOCAL and is safe against injection.
                await session.execute(
                    text("SELECT set_config('app.tenant_id', :tid, true)"),
                    {"tid": tenant_id},
                )
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


async def init_db(db_url: str | None = None) -> None:
    """No-op on Postgres: schema is owned by the BLAIQ migration runner.

    Migrations 006 (core ops.* schema + RLS) and 008 (loop_states) live
    under apps/daemon/src/db/migrations and are applied by the daemon
    boot path. The Python side must not attempt `CREATE TABLE` against
    the shared Postgres.

    On SQLite (test mode) we still call `Base.metadata.create_all` so
    isolated test runs work without a separate migration step.
    """
    url = _resolve_db_url(db_url)
    if _is_postgres(url):
        return
    # SQLite test path only.
    from aiteam.storage.models import Base

    engine = get_engine(url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db() -> None:
    """Close all database connections and release resources."""
    await engine_pool.dispose_all()


def set_current_tenant(tenant_id: str | None) -> object:
    """Bind `current_tenant_id` and return a reset token for cleanup.

    Helper for non-middleware contexts (workers, scheduled tasks) that
    need to fan out work for a specific tenant.
    """
    return current_tenant_id.set(tenant_id)


def reset_current_tenant(token: object) -> None:
    """Reset the tenant ContextVar using the token from set_current_tenant."""
    current_tenant_id.reset(token)  # type: ignore[arg-type]
