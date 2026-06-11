"""Unit tests for the v1.5.0-B EcosystemShallowQueueWorker — dispatch path."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest
import pytest_asyncio

from aiteam.services.ecosystem_shallow_queue import (
    DispatchIntent,
    EcosystemShallowQueueWorker,
    SHALLOW_AGENT_PROMPT,
    STAGE0_TIMEOUT_SECONDS,
)
from aiteam.storage.connection import close_db
from aiteam.storage.repository import StorageRepository
from aiteam.types import (
    EcosystemDeepReviewStatus,
    EcosystemProjectSettings,
    EcosystemRepoProfile,
    EcosystemStageStatus,
)


# ============================================================
# Fixtures
# ============================================================


@pytest_asyncio.fixture()
async def repo() -> StorageRepository:
    r = StorageRepository(db_url="sqlite+aiosqlite://")
    await r.init_db()
    yield r  # type: ignore[misc]
    await close_db()


async def _make_profile(
    repo: StorageRepository,
    full_name: str,
    *,
    stars: int = 5000,
    project_id: str = "proj-test",
    is_active: bool = True,
    shallow_summary: str = "",
) -> str:
    """Insert a profile and return its id."""
    profile = EcosystemRepoProfile(
        project_id=project_id,
        repo_full_name=full_name,
        name=full_name.split("/")[-1],
        owner=full_name.split("/")[0],
        stars=stars,
        is_active=is_active,
        shallow_summary=shallow_summary,
        last_scanned_at=datetime.now(tz=timezone.utc),
    )
    await repo.upsert_ecosystem_profile(profile, project_id=project_id)
    fetched = await repo.get_ecosystem_profile(full_name, project_id=project_id)
    assert fetched is not None
    return fetched.id


async def _seed_settings(
    repo: StorageRepository,
    project_id: str = "proj-test",
    *,
    min_stars: int = 1000,
    top_n: int = 50,
    concurrency: int = 5,
) -> None:
    settings = EcosystemProjectSettings(
        project_id=project_id,
        min_stars=min_stars,
        top_n=top_n,
        shallow_concurrency=concurrency,
    )
    await repo.upsert_ecosystem_project_settings(settings)


# ============================================================
# Dispatch path
# ============================================================


async def test_tick_dispatches_active_profiles_missing_summary(
    repo: StorageRepository,
) -> None:
    """tick() picks active profiles with empty shallow_summary and dispatches."""
    await _seed_settings(repo)
    repo_a = await _make_profile(repo, "owner/a", stars=10000)
    repo_b = await _make_profile(repo, "owner/b", stars=5000)
    # Already-summarized profile should be skipped.
    await _make_profile(
        repo, "owner/c", stars=4000, shallow_summary="既有总结"
    )

    worker = EcosystemShallowQueueWorker(repo, project_id="proj-test")
    result = await worker.tick()

    assert result.dispatched == 2
    assert result.queued == 2  # only candidates, owner/c was filtered
    dispatched_ids = {i.repo_id for i in result.intents}
    assert dispatched_ids == {repo_a, repo_b}

    # Each dispatch should have created a deep_review row in RUNNING state.
    for intent in result.intents:
        assert intent.repo_full_name in {"owner/a", "owner/b"}
        assert intent.timeout_seconds == STAGE0_TIMEOUT_SECONDS
        review = await repo.get_deep_review(
            intent.deep_review_id, project_id="proj-test"
        )
        assert review is not None
        assert review.status == EcosystemDeepReviewStatus.RUNNING
        assert review.dispatch_prompt
        assert intent.repo_full_name in review.dispatch_prompt


async def test_tick_respects_concurrency_budget(repo: StorageRepository) -> None:
    """Concurrency from project settings caps dispatches per tick."""
    await _seed_settings(repo, concurrency=2)
    for i in range(5):
        await _make_profile(repo, f"owner/r{i}", stars=2000 + i)

    worker = EcosystemShallowQueueWorker(repo, project_id="proj-test")
    result = await worker.tick()
    assert result.dispatched == 2
    assert result.queued == 5


async def test_tick_skips_inflight_repo(repo: StorageRepository) -> None:
    """Re-running tick does not duplicate dispatch for in-flight repos."""
    await _seed_settings(repo)
    rid = await _make_profile(repo, "owner/x", stars=8000)

    worker = EcosystemShallowQueueWorker(repo, project_id="proj-test")
    first = await worker.tick()
    assert first.dispatched == 1

    second = await worker.tick()
    assert second.dispatched == 0
    assert second.skipped_inflight == 1


async def test_tick_skips_inactive_or_failed_profiles(
    repo: StorageRepository,
) -> None:
    """is_active=False / is_deleted / is_private_now repos are excluded."""
    await _seed_settings(repo)
    inactive = await _make_profile(
        repo, "owner/inactive", stars=2000, is_active=False
    )
    deleted = await _make_profile(repo, "owner/deleted", stars=2000)
    await repo.mark_profile_deleted(deleted, project_id="proj-test")
    private = await _make_profile(repo, "owner/private", stars=2000)
    await repo.mark_profile_private(private, project_id="proj-test")
    alive = await _make_profile(repo, "owner/alive", stars=2000)

    worker = EcosystemShallowQueueWorker(repo, project_id="proj-test")
    result = await worker.tick()
    assert result.dispatched == 1
    assert result.intents[0].repo_id == alive
    assert inactive not in {i.repo_id for i in result.intents}


async def test_enqueue_repo_dispatches_one(repo: StorageRepository) -> None:
    """Scanner hook entry point dispatches a single repo."""
    await _seed_settings(repo)
    rid = await _make_profile(repo, "owner/new", stars=3000)

    worker = EcosystemShallowQueueWorker(repo, project_id="proj-test")
    intent = await worker.enqueue_repo(rid)
    assert isinstance(intent, DispatchIntent)
    assert intent.repo_id == rid
    assert "owner/new" in intent.prompt


async def test_enqueue_repo_skips_already_summarized(
    repo: StorageRepository,
) -> None:
    """enqueue_repo no-ops on profiles that already have a summary."""
    await _seed_settings(repo)
    rid = await _make_profile(
        repo, "owner/done", stars=3000, shallow_summary="已扫描"
    )

    worker = EcosystemShallowQueueWorker(repo, project_id="proj-test")
    intent = await worker.enqueue_repo(rid)
    assert intent is None


async def test_prompt_injects_lessons_from_pattern_searcher(
    repo: StorageRepository,
) -> None:
    """When pattern_searcher returns failure patterns they are injected."""
    await _seed_settings(repo)
    await _make_profile(repo, "owner/repo", stars=4000)

    async def fake_pattern_searcher(query: str, top_k: int = 3):
        return [
            {
                "type": "failure",
                "error": "description too short",
                "lesson": "fall back to README",
            }
        ]

    worker = EcosystemShallowQueueWorker(
        repo,
        project_id="proj-test",
        pattern_searcher=fake_pattern_searcher,
    )
    result = await worker.tick()
    assert result.dispatched == 1
    prompt = result.intents[0].prompt
    assert "fall back to README" in prompt
    assert "description too short" in prompt


async def test_settings_auto_created_when_missing(
    repo: StorageRepository,
) -> None:
    """Worker auto-creates default settings when none exist."""
    await _make_profile(repo, "owner/r", stars=1500)

    worker = EcosystemShallowQueueWorker(repo, project_id="proj-test")
    result = await worker.tick()
    # Default settings (min_stars=1000, top_n=100) so the 1500-star repo qualifies.
    assert result.dispatched == 1
    settings = await repo.get_ecosystem_project_settings("proj-test")
    assert settings is not None
    assert settings.min_stars == 1000


async def test_queue_status_returns_metrics(repo: StorageRepository) -> None:
    """queue_status() reports active / pending / failed counts."""
    await _seed_settings(repo)
    await _make_profile(repo, "owner/a", stars=2000)  # pending
    await _make_profile(
        repo, "owner/b", stars=2000, shallow_summary="done"
    )  # active+done
    deleted = await _make_profile(repo, "owner/del", stars=2000)
    await repo.mark_profile_deleted(deleted, project_id="proj-test")

    worker = EcosystemShallowQueueWorker(repo, project_id="proj-test")
    status = await worker.queue_status()
    assert status["pending_shallow"] == 1
    assert status["deleted"] == 1
    assert status["concurrency"] == 5


async def test_no_project_id_returns_empty_tick(repo: StorageRepository) -> None:
    """Worker without project_id has no settings -> no work."""
    await _make_profile(repo, "owner/a", stars=2000, project_id="proj-x")

    worker = EcosystemShallowQueueWorker(repo, project_id="")
    result = await worker.tick()
    assert result.dispatched == 0
    assert result.queued == 0
