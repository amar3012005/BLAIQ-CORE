"""AI Team OS — API dependency injection (BLAIQ Track D, per-tenant).

Track A.2 collapsed the SQLite/Alembic boot path. Track D goes further:
the sidecar process no longer keeps *global* StorageRepository /
MemoryStore / EventBus / TeamManager / StateReaper / WatchdogRunner /
LoopEngine singletons. Each of those objects is per-tenant now — the
shared Postgres holds rows for every BLAIQ tenant, but every cached
service object is scoped to a single tenant_id and queries are issued
under that tenant's `app.tenant_id` GUC via the ContextVar in
``aiteam.storage.connection``.

Concretely:

* ``TenantState`` bundles one tenant's full service graph.
* ``get_tenant_state(tenant_id)`` is the only creation site; it is
  called lazily by the FastAPI dependencies, by background workers,
  and by the explicit ``POST /admin/tenant/{id}/activate`` admin hook.
* Background tasks (StateReaper, WatchdogRunner) are started per
  tenant on first activation. ``TenantScheduler`` evicts tenant
  states whose ``last_used_at`` exceeds ``TENANT_IDLE_TTL`` (default
  1h) and tears down their background tasks first.
* The FastAPI ``Depends(get_*)`` helpers infer the tenant from
  ``current_tenant_id`` (set by ``TenantMiddleware``) and return the
  matching tenant-scoped service. They raise 400 if the middleware
  did not bind a tenant — the proxy in
  ``apps/daemon/src/admin/admin-routes.ts`` always injects
  ``X-Tenant-Id``, so a missing tenant is a programming error.
"""

from __future__ import annotations

import asyncio
import os
import logging
import time
from dataclasses import dataclass, field
from typing import Awaitable, Callable

from fastapi import HTTPException, Request

from aiteam.api.event_bus import EventBus
from aiteam.api.hook_translator import HookTranslator
from aiteam.api.state_reaper import StateReaper
from aiteam.loop.engine import LoopEngine
from aiteam.loop.watchdog import WatchdogChecker, WatchdogRunner
from aiteam.memory.store import MemoryStore
from aiteam.orchestrator.team_manager import TeamManager
from aiteam.storage.connection import (
    close_db,
    current_tenant_id,
    reset_current_tenant,
    set_current_tenant,
)
from aiteam.storage.repository import StorageRepository
from aiteam.types import AgentStatus

logger = logging.getLogger(__name__)

# Evict tenant state objects (and their background tasks) after this many
# seconds without a request. Tunable via env in a follow-up; 1h matches
# the BLAIQ admin proxy keep-alive window.
TENANT_IDLE_TTL_SECONDS = 60 * 60

# Scheduler sweep cadence — how often we look for idle tenants to evict.
TENANT_SWEEP_INTERVAL_SECONDS = 5 * 60


@dataclass
class TenantState:
    """All service objects scoped to a single tenant.

    Created lazily by ``get_tenant_state`` and reused for the lifetime
    of the FastAPI process (or until ``TenantScheduler`` evicts it).
    Background tasks are started once and torn down on eviction /
    shutdown.
    """

    tenant_id: str
    repository: StorageRepository
    memory_store: MemoryStore
    event_bus: EventBus
    manager: TeamManager
    hook_translator: HookTranslator
    loop_engine: LoopEngine
    reaper: StateReaper
    watchdog_runner: WatchdogRunner
    background_started: bool = False
    last_used_at: float = field(default_factory=time.monotonic)
    clickup_poller_task: asyncio.Task[None] | None = None
    poool_sync_task: asyncio.Task[None] | None = None
    payment_check_task: asyncio.Task[None] | None = None
    content_sched_task: asyncio.Task[None] | None = None

    def touch(self) -> None:
        """Bump the LRU timestamp; called on every dependency lookup."""
        self.last_used_at = time.monotonic()


# Tenant-scoped registry. Guarded by ``_state_lock`` for concurrent
# creation in a single event loop. Keys are tenant UUID strings (the
# same shape the TenantMiddleware validates).
_tenant_states: dict[str, TenantState] = {}
_state_lock: asyncio.Lock = asyncio.Lock()
_scheduler: TenantScheduler | None = None


# ---------------------------------------------------------------------------
# Tenant scheduler — evicts idle tenants and tears down their workers.
# ---------------------------------------------------------------------------


class TenantScheduler:
    """Background coroutine that evicts idle tenant states.

    Holds no state of its own; reads ``_tenant_states`` under
    ``_state_lock`` and shuts down each tenant's background tasks
    before removing the entry from the registry.
    """

    def __init__(self, idle_ttl: float, interval: float) -> None:
        self._idle_ttl = idle_ttl
        self._interval = interval
        self._task: asyncio.Task[None] | None = None
        self._running: bool = False

    def start(self) -> None:
        if self._task is not None:
            return
        self._running = True
        self._task = asyncio.create_task(self._loop(), name="tenant-scheduler")
        logger.info(
            "TenantScheduler started (idle_ttl=%ds, interval=%ds)",
            self._idle_ttl,
            self._interval,
        )

    async def stop(self) -> None:
        self._running = False
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def _loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(self._interval)
            except asyncio.CancelledError:
                break
            try:
                await self._sweep_once()
            except Exception:
                logger.exception("TenantScheduler sweep failed")

    async def _sweep_once(self) -> None:
        now = time.monotonic()
        async with _state_lock:
            stale: list[str] = [
                tid
                for tid, st in _tenant_states.items()
                if (now - st.last_used_at) > self._idle_ttl
            ]
        for tid in stale:
            await _evict_tenant(tid, reason="idle")


# ---------------------------------------------------------------------------
# Lifecycle: init / cleanup are now process-wide bootstraps that do *not*
# create any per-tenant state. Tenant state is built on first use.
# ---------------------------------------------------------------------------


async def init_dependencies() -> None:
    """Process-level startup. Per-tenant state is lazy from here on."""
    global _scheduler  # noqa: PLW0603
    if _scheduler is None:
        _scheduler = TenantScheduler(
            idle_ttl=TENANT_IDLE_TTL_SECONDS,
            interval=TENANT_SWEEP_INTERVAL_SECONDS,
        )
        _scheduler.start()
    logger.info(
        "init_dependencies complete: per-tenant lazy mode, scheduler running"
    )


async def cleanup_dependencies() -> None:
    """Process-level shutdown. Tear down all tenants and the scheduler."""
    global _scheduler  # noqa: PLW0603
    if _scheduler is not None:
        await _scheduler.stop()
        _scheduler = None

    async with _state_lock:
        tenant_ids = list(_tenant_states.keys())
    for tid in tenant_ids:
        await _evict_tenant(tid, reason="shutdown")

    await close_db()


# ---------------------------------------------------------------------------
# Tenant state factory.
# ---------------------------------------------------------------------------


async def get_tenant_state(tenant_id: str) -> TenantState:
    """Return (and lazily create) the service graph for ``tenant_id``.

    Safe to call from FastAPI dependencies and from background workers.
    Creation is serialized via ``_state_lock`` so concurrent first-hits
    do not build two graphs for the same tenant.
    """
    cached = _tenant_states.get(tenant_id)
    if cached is not None:
        cached.touch()
        return cached

    async with _state_lock:
        cached = _tenant_states.get(tenant_id)
        if cached is not None:
            cached.touch()
            return cached

        state = await _build_tenant_state(tenant_id)
        _tenant_states[tenant_id] = state
        logger.info("Tenant state created: tenant=%s", tenant_id)

    # Start background tasks outside the lock — they call back into the
    # repository under the tenant's ContextVar binding.
    await _start_background_tasks(state)
    return state


async def _build_tenant_state(tenant_id: str) -> TenantState:
    """Construct the service graph for a tenant; no DB writes here."""
    repository = StorageRepository()
    memory_store = MemoryStore(repository=repository)
    event_bus = EventBus(repo=repository)
    manager = TeamManager(
        repository=repository,
        memory=memory_store,
        event_bus=event_bus,
    )
    hook_translator = HookTranslator(repo=repository, event_bus=event_bus)
    loop_engine = LoopEngine(repo=repository, tenant_id=tenant_id)
    reaper = StateReaper(repo=repository, event_bus=event_bus, tenant_id=tenant_id)
    watchdog_checker = WatchdogChecker(repo=repository)
    watchdog_runner = WatchdogRunner(
        checker=watchdog_checker,
        event_bus=event_bus,
        tenant_id=tenant_id,
    )

    return TenantState(
        tenant_id=tenant_id,
        repository=repository,
        memory_store=memory_store,
        event_bus=event_bus,
        manager=manager,
        hook_translator=hook_translator,
        loop_engine=loop_engine,
        reaper=reaper,
        watchdog_runner=watchdog_runner,
    )


async def _start_background_tasks(state: TenantState) -> None:
    """Start StateReaper, WatchdogRunner, and run startup reconciliation.

    Each call is bound to the tenant's ContextVar so any DB work
    happens under ``SET LOCAL app.tenant_id = <tid>``.
    """
    if state.background_started:
        return

    token = set_current_tenant(state.tenant_id)
    try:
        try:
            await _startup_reconciliation(state.repository)
        except Exception as exc:
            logger.warning(
                "Startup reconciliation skipped (tenant=%s): %s",
                state.tenant_id,
                exc,
            )

        state.reaper.start()
        state.watchdog_runner.start()

        # ClickUp bidirectional poller — pulls ClickUp tasks every 5 min
        # and upserts them into ops.tasks under the tenant's RLS binding.
        if os.environ.get("BLAIQ_CLICKUP_POLLER_ENABLED", "true").lower() != "false":
            from aiteam.integrations.clickup import poll_clickup

            async def _bound_poller(tid: str = state.tenant_id) -> None:
                token_inner = set_current_tenant(tid)
                try:
                    await poll_clickup(tid)
                finally:
                    reset_current_tenant(token_inner)

            state.clickup_poller_task = asyncio.create_task(
                _bound_poller(), name=f"clickup-poller:{state.tenant_id}"
            )

        # POOOL read-through cache sync — pulls timetrack/orders/invoices into
        # ops.poool_cache every ~30 min. No-op until the tenant enables POOOL.
        if os.environ.get("BLAIQ_POOOL_SYNC_ENABLED", "true").lower() != "false":
            from aiteam.integrations.poool import poll_poool

            try:
                _poool_interval = float(
                    os.environ.get("BLAIQ_POOOL_SYNC_INTERVAL_S", "1800") or 1800
                )
            except ValueError:
                _poool_interval = 1800.0

            async def _bound_poool_sync(
                tid: str = state.tenant_id, interval: float = _poool_interval
            ) -> None:
                token_inner = set_current_tenant(tid)
                try:
                    await poll_poool(tid, interval_s=interval)
                finally:
                    reset_current_tenant(token_inner)

            state.poool_sync_task = asyncio.create_task(
                _bound_poool_sync(), name=f"poool-sync:{state.tenant_id}"
            )

        # Payment-overdue sweep — always on (no POOOL needed), daily. Flips
        # invoiced jobs past their due date to 'overdue' from local data.
        if os.environ.get("BLAIQ_PAYMENT_CHECK_ENABLED", "true").lower() != "false":
            from aiteam.integrations.poool import poll_payment_check

            try:
                _pay_interval = float(
                    os.environ.get("BLAIQ_PAYMENT_CHECK_INTERVAL_S", "86400") or 86400
                )
            except ValueError:
                _pay_interval = 86400.0

            async def _bound_payment_check(
                tid: str = state.tenant_id, interval: float = _pay_interval
            ) -> None:
                token_inner = set_current_tenant(tid)
                try:
                    await poll_payment_check(tid, interval_s=interval)
                finally:
                    reset_current_tenant(token_inner)

            state.payment_check_task = asyncio.create_task(
                _bound_payment_check(), name=f"payment-check:{state.tenant_id}"
            )

        # Content scheduler — generates recurring on-brand drafts for any
        # ops.content_schedules the tenant defines. No-op until schedules exist.
        if os.environ.get("BLAIQ_CONTENT_SCHED_ENABLED", "true").lower() != "false":
            from aiteam.integrations.scheduler import poll_content_schedules

            try:
                _sched_interval = float(os.environ.get("BLAIQ_CONTENT_SCHED_INTERVAL_S", "300") or 300)
            except ValueError:
                _sched_interval = 300.0

            async def _bound_content_sched(
                tid: str = state.tenant_id, interval: float = _sched_interval
            ) -> None:
                token_inner = set_current_tenant(tid)
                try:
                    await poll_content_schedules(tid, interval_s=interval)
                finally:
                    reset_current_tenant(token_inner)

            state.content_sched_task = asyncio.create_task(
                _bound_content_sched(), name=f"content-sched:{state.tenant_id}"
            )

        state.background_started = True
    finally:
        reset_current_tenant(token)


async def _evict_tenant(tenant_id: str, *, reason: str) -> None:
    """Stop background workers and drop a tenant from the registry."""
    async with _state_lock:
        state = _tenant_states.pop(tenant_id, None)
    if state is None:
        return

    if state.background_started:
        if state.clickup_poller_task is not None:
            state.clickup_poller_task.cancel()
            try:
                await state.clickup_poller_task
            except (asyncio.CancelledError, Exception):
                pass
            state.clickup_poller_task = None
        if state.poool_sync_task is not None:
            state.poool_sync_task.cancel()
            try:
                await state.poool_sync_task
            except (asyncio.CancelledError, Exception):
                pass
            state.poool_sync_task = None
        if state.payment_check_task is not None:
            state.payment_check_task.cancel()
            try:
                await state.payment_check_task
            except (asyncio.CancelledError, Exception):
                pass
            state.payment_check_task = None
        try:
            await state.watchdog_runner.stop()
        except Exception:
            logger.exception("Watchdog stop failed (tenant=%s)", tenant_id)
        try:
            await state.reaper.stop()
        except Exception:
            logger.exception("Reaper stop failed (tenant=%s)", tenant_id)

    logger.info("Tenant state evicted: tenant=%s reason=%s", tenant_id, reason)


async def run_under_tenant(
    tenant_id: str,
    fn: Callable[[TenantState], Awaitable[None]],
) -> None:
    """Helper for cron / scheduler jobs that need to fan out per tenant.

    Binds the ContextVar, fetches (or builds) the TenantState, runs
    ``fn``, and unbinds the ContextVar on exit. The caller is
    responsible for iterating tenants — we deliberately do not have a
    "list all tenants" walker here because the source of truth is the
    BLAIQ daemon's tenants table.
    """
    token = set_current_tenant(tenant_id)
    try:
        state = await get_tenant_state(tenant_id)
        await fn(state)
    finally:
        reset_current_tenant(token)


async def _startup_reconciliation(repo: StorageRepository) -> None:
    """Reset stale BUSY agents to WAITING on first tenant activation.

    Runs once per tenant under that tenant's RLS binding.
    """
    from datetime import datetime, timedelta, timezone

    stale_cutoff = datetime.now(tz=timezone.utc) - timedelta(hours=1)
    teams = await repo.list_teams()
    reconciled = 0
    stale_count = 0
    for team in teams:
        agents = await repo.list_agents(team.id)
        for agent in agents:
            needs_update = False
            updates: dict[str, object] = {}
            if agent.status == AgentStatus.BUSY:
                updates["status"] = AgentStatus.WAITING.value
                updates["current_task"] = None
                needs_update = True
            if agent.session_id:
                updates["session_id"] = None
                needs_update = True
            if needs_update:
                await repo.update_agent(agent.id, **updates)
                reconciled += 1

            effective_status = updates.get("status", agent.status)
            if (
                effective_status in (AgentStatus.WAITING, AgentStatus.WAITING.value)
                and agent.last_active_at
                and agent.last_active_at < stale_cutoff
            ):
                await repo.update_agent(agent.id, status=AgentStatus.OFFLINE.value)
                stale_count += 1

    if reconciled > 0:
        logger.warning(
            "Startup reconciliation: %d agents reset (status + session cleared)",
            reconciled,
        )
    if stale_count > 0:
        logger.info(
            "Startup reconciliation: %d stale waiting agents set to offline",
            stale_count,
        )


# ---------------------------------------------------------------------------
# FastAPI dependency helpers.
#
# Every helper resolves the tenant from the ContextVar populated by
# TenantMiddleware. If the ContextVar is unset we raise 400 — the
# BLAIQ admin proxy always sets X-Tenant-Id, so a missing tenant is a
# wiring bug we want to surface loudly rather than silently fall back
# to an "any tenant" repository.
# ---------------------------------------------------------------------------


def _require_tenant_id() -> str:
    tenant_id = current_tenant_id.get()
    if not tenant_id:
        raise HTTPException(
            status_code=400,
            detail="X-Tenant-Id is required (TenantMiddleware did not bind a tenant).",
        )
    return tenant_id


async def _resolve_state() -> TenantState:
    return await get_tenant_state(_require_tenant_id())


async def get_manager() -> TeamManager:
    return (await _resolve_state()).manager


async def get_repository() -> StorageRepository:
    return (await _resolve_state()).repository


async def get_global_repository() -> StorageRepository:
    """Alias retained for legacy cross-project endpoints."""
    return await get_repository()


async def get_scoped_repository(request: Request) -> StorageRepository:  # noqa: ARG001
    """Return the tenant-scoped repository.

    The ``request`` argument is retained for API compatibility with the
    legacy header-driven scoping; we no longer read it.
    """
    return await get_repository()


async def get_memory_store() -> MemoryStore:
    return (await _resolve_state()).memory_store


async def get_event_bus() -> EventBus:
    return (await _resolve_state()).event_bus


async def get_hook_translator() -> HookTranslator:
    return (await _resolve_state()).hook_translator


async def get_loop_engine() -> LoopEngine:
    return (await _resolve_state()).loop_engine


# ---------------------------------------------------------------------------
# Admin hook — explicit warm-up endpoint.
# ---------------------------------------------------------------------------


async def activate_tenant(tenant_id: str) -> TenantState:
    """Public helper for ``POST /admin/tenant/{id}/activate``.

    Eagerly builds the tenant state and starts its background workers.
    Returns the resulting state so the route can report e.g. cycle
    counters or watchdog status.
    """
    token = set_current_tenant(tenant_id)
    try:
        return await get_tenant_state(tenant_id)
    finally:
        reset_current_tenant(token)


async def deactivate_tenant(tenant_id: str) -> bool:
    """Tear down a tenant's services. Returns True if anything was removed."""
    existed = tenant_id in _tenant_states
    await _evict_tenant(tenant_id, reason="admin")
    return existed
