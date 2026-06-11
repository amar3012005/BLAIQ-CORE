"""AI Team OS — pytest 全局 fixtures."""

from __future__ import annotations

from pathlib import Path

import pytest
import pytest_asyncio

from aiteam.storage.connection import close_db
from aiteam.storage.repository import StorageRepository


@pytest.fixture()
def tmp_project_dir(tmp_path: Path) -> Path:
    """创建临时目录作为项目目录."""
    project_dir = tmp_path / "test-project"
    project_dir.mkdir()
    aiteam_dir = project_dir / ".aiteam"
    aiteam_dir.mkdir()
    return project_dir


@pytest_asyncio.fixture()
async def db_repository() -> StorageRepository:
    """创建内存 SQLite 的 StorageRepository 实例.

    使用 sqlite+aiosqlite:// 内存数据库，测试结束后自动清理。
    """
    repo = StorageRepository(db_url="sqlite+aiosqlite://")
    await repo.init_db()
    yield repo  # type: ignore[misc]
    await close_db()
