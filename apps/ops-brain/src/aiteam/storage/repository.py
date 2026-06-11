"""AI Team OS — Data persistence repository.

StorageRepository is the unified entry point for all database operations.
Upper-layer modules access data only through this interface.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import String as SAString
from sqlalchemy import case, delete, func, select

from aiteam.api.exceptions import NotFoundError
from aiteam.storage.connection import get_session
from aiteam.storage.connection import init_db as _init_db
from aiteam.storage.models import (
    AgentActivityModel,
    AgentModel,
    ChannelMessageModel,
    CrossMessageModel,
    EcosystemDeepReviewModel,
    EcosystemProjectSettingsModel,
    EcosystemRelationModel,
    EcosystemRepoProfileModel,
    EcosystemRepoStatusSnapshotModel,
    EcosystemRepoTagModel,
    EcosystemScanRunModel,
    EcosystemTagModel,
    EventModel,
    LeaderBriefingModel,
    MeetingMessageModel,
    MeetingModel,
    MemoryModel,
    PhaseModel,
    PipelineStageHistoryModel,
    ProjectModel,
    ReportModel,
    ScheduledTaskModel,
    TaskModel,
    TeamModel,
    WakeSessionModel,
)
from aiteam.types import (
    Agent,
    AgentActivity,
    AgentStatus,
    ChannelMessage,
    CrossMessage,
    CrossMessageType,
    EcosystemDeepReview,
    EcosystemDeepReviewStatus,
    EcosystemProjectSettings,
    EcosystemRelation,
    EcosystemRepoProfile,
    EcosystemRepoStatusSnapshot,
    EcosystemRepoTag,
    EcosystemScanRun,
    EcosystemStageStatus,
    EcosystemTag,
    Event,
    EventType,
    LeaderBriefing,
    Meeting,
    MeetingMessage,
    MeetingStatus,
    Memory,
    MemoryScope,
    OrchestrationMode,
    Phase,
    PhaseStatus,
    PipelineState,
    Project,
    Report,
    ScheduledTask,
    StageTransition,
    Task,
    TaskStatus,
    Team,
    WakeSession,
)


class StorageRepository:
    """Data persistence repository — unified data access interface."""

    def __init__(self, db_url: str | None = None, project_scope: str = "") -> None:
        self._db_url = db_url
        self._project_scope = project_scope  # Current project ID; empty = no filtering

    def _apply_project_filter(self, query: Any, model_class: Any) -> Any:
        """Auto-apply project_id filter if project_scope is set and model has project_id."""
        if self._project_scope and hasattr(model_class, "project_id"):
            query = query.where(model_class.project_id == self._project_scope)
        return query

    async def init_db(self) -> None:
        """Initialize database (create tables / run migrations)."""
        await _init_db(self._db_url)

    # ================================================================
    # Projects
    # ================================================================

    async def create_project(
        self,
        name: str,
        root_path: str = "",
        description: str = "",
        config: dict | None = None,
    ) -> Project:
        """Create a project."""
        project = Project(
            name=name,
            root_path=root_path,
            description=description,
            config=config or {},
        )
        orm = ProjectModel.from_pydantic(project)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return project

    async def get_project(self, project_id: str) -> Project | None:
        """Get a project by ID."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(ProjectModel).where(ProjectModel.id == project_id)
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def list_projects(self) -> list[Project]:
        """List all projects."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(ProjectModel).order_by(ProjectModel.created_at.desc())
            )
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def update_project(self, project_id: str, **kwargs: object) -> Project | None:
        """Update project information."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(ProjectModel).where(ProjectModel.id == project_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None

            kwargs["updated_at"] = datetime.now()

            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)

            return row.to_pydantic()

    async def delete_project(self, project_id: str) -> bool:
        """Delete a project with full cascade cleanup of all associated data."""
        async with get_session(self._db_url) as session:
            # Check project exists
            proj = await session.get(ProjectModel, project_id)
            if not proj:
                return False

            # Cascade: delete meeting messages for project meetings
            meeting_ids_stmt = select(MeetingModel.id).where(MeetingModel.project_id == project_id)
            await session.execute(
                delete(MeetingMessageModel).where(
                    MeetingMessageModel.meeting_id.in_(meeting_ids_stmt)
                )
            )
            # Cascade: meetings
            await session.execute(delete(MeetingModel).where(MeetingModel.project_id == project_id))
            # Cascade: tasks (includes subtasks via project_id)
            await session.execute(delete(TaskModel).where(TaskModel.project_id == project_id))
            # Cascade: agents for project teams
            team_ids_stmt = select(TeamModel.id).where(TeamModel.project_id == project_id)
            await session.execute(
                delete(AgentModel).where(AgentModel.team_id.in_(team_ids_stmt))
            )
            # Cascade: teams
            await session.execute(delete(TeamModel).where(TeamModel.project_id == project_id))
            # Cascade: phases
            await session.execute(delete(PhaseModel).where(PhaseModel.project_id == project_id))
            # Cascade: reports
            await session.execute(delete(ReportModel).where(ReportModel.project_id == project_id))
            # Cascade: briefings
            await session.execute(delete(LeaderBriefingModel).where(LeaderBriefingModel.project_id == project_id))
            # Cascade: memories (project-scoped)
            await session.execute(
                delete(MemoryModel).where(
                    (MemoryModel.scope == "project") & (MemoryModel.scope_id == project_id)
                )
            )
            # Cascade: cross-project messages
            await session.execute(
                delete(CrossMessageModel).where(
                    (CrossMessageModel.from_project_id == project_id)
                    | (CrossMessageModel.to_project_id == project_id)
                )
            )
            # Cascade: events for project teams
            await session.execute(
                delete(EventModel).where(EventModel.team_id.in_(team_ids_stmt))
            )
            # Finally: delete project itself
            await session.execute(delete(ProjectModel).where(ProjectModel.id == project_id))
            return True

    async def get_project_by_root_path(self, root_path: str) -> Project | None:
        """Get a project by root_path."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(ProjectModel).where(ProjectModel.root_path == root_path)
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    # ================================================================
    # Phases
    # ================================================================

    async def create_phase(
        self,
        project_id: str,
        name: str,
        description: str = "",
        order: int = 0,
        config: dict | None = None,
    ) -> Phase:
        """Create a phase."""
        phase = Phase(
            project_id=project_id,
            name=name,
            description=description,
            order=order,
            config=config or {},
        )
        orm = PhaseModel.from_pydantic(phase)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return phase

    async def get_phase(self, phase_id: str) -> Phase | None:
        """Get a phase by ID."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(PhaseModel).where(PhaseModel.id == phase_id))
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def list_phases(self, project_id: str) -> list[Phase]:
        """List all phases under a project, sorted by order."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(PhaseModel)
                .where(PhaseModel.project_id == project_id)
                .order_by(PhaseModel.order, PhaseModel.created_at)
            )
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def update_phase(self, phase_id: str, **kwargs: object) -> Phase | None:
        """Update phase information."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(PhaseModel).where(PhaseModel.id == phase_id))
            row = result.scalar_one_or_none()
            if row is None:
                return None

            # Handle status field: convert to string value
            if "status" in kwargs:
                status_val = kwargs["status"]
                if isinstance(status_val, PhaseStatus):
                    kwargs["status"] = status_val.value
                elif isinstance(status_val, str):
                    PhaseStatus(status_val)

            kwargs["updated_at"] = datetime.now()

            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)

            return row.to_pydantic()

    async def delete_phase(self, phase_id: str) -> bool:
        """Delete a phase."""
        async with get_session(self._db_url) as session:
            result = await session.execute(delete(PhaseModel).where(PhaseModel.id == phase_id))
            return result.rowcount > 0  # type: ignore[union-attr]

    async def get_active_phase(self, project_id: str) -> Phase | None:
        """Get the currently active phase of a project."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(PhaseModel).where(
                    PhaseModel.project_id == project_id,
                    PhaseModel.status == PhaseStatus.ACTIVE.value,
                )
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def deactivate_phases(self, project_id: str) -> int:
        """Set all active phases under a project to completed."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(PhaseModel).where(
                    PhaseModel.project_id == project_id,
                    PhaseModel.status == PhaseStatus.ACTIVE.value,
                )
            )
            rows = result.scalars().all()
            for row in rows:
                row.status = PhaseStatus.COMPLETED.value
                row.updated_at = datetime.now()
            return len(rows)

    # ================================================================
    # Teams
    # ================================================================

    async def create_team(
        self,
        name: str,
        mode: str,
        config: dict | None = None,
        **kwargs: Any,
    ) -> Team:
        """Create a team."""
        # Auto-fill project_id from scope if not explicitly provided
        effective_project_id = kwargs.get("project_id") or (self._project_scope or None)
        team = Team(
            name=name,
            mode=OrchestrationMode(mode),
            config=config or {},
            project_id=effective_project_id,
            leader_agent_id=kwargs.get("leader_agent_id"),
        )
        orm = TeamModel.from_pydantic(team)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return team

    async def get_team(self, team_id: str) -> Team | None:
        """Get a team by ID."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(TeamModel).where(TeamModel.id == team_id))
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def get_team_by_name(self, name: str) -> Team | None:
        """Get a team by name."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(TeamModel).where(TeamModel.name == name))
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def list_teams(self) -> list[Team]:
        """List all teams."""
        async with get_session(self._db_url) as session:
            stmt = select(TeamModel).order_by(TeamModel.created_at.desc())
            stmt = self._apply_project_filter(stmt, TeamModel)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def list_teams_by_project(self, project_id: str) -> list[Team]:
        """List all teams under a project."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(TeamModel)
                .where(TeamModel.project_id == project_id)
                .order_by(TeamModel.created_at.desc())
            )
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def find_active_team_by_leader(self, leader_agent_id: str) -> Team | None:
        """Find the active team currently led by a Leader."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(TeamModel)
                .where(TeamModel.leader_agent_id == leader_agent_id)
                .where(TeamModel.status == "active")
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def find_leader_by_project(self, project_id: str) -> Agent | None:
        """Find the Leader agent for a project (role=leader + project_id match)."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(AgentModel)
                .where(AgentModel.project_id == project_id)
                .where(AgentModel.role == "leader")
                .order_by(AgentModel.created_at.desc())
                .limit(1)
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def update_team(self, team_id: str, **kwargs: object) -> Team:
        """Update team information."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(TeamModel).where(TeamModel.id == team_id))
            row = result.scalar_one_or_none()
            if row is None:
                msg = f"团队 {team_id} 不存在"
                raise NotFoundError(msg)

            # Handle mode field: convert to string value
            if "mode" in kwargs:
                mode_val = kwargs["mode"]
                if isinstance(mode_val, OrchestrationMode):
                    kwargs["mode"] = mode_val.value
                elif isinstance(mode_val, str):
                    # Validate the value is valid
                    OrchestrationMode(mode_val)

            kwargs["updated_at"] = datetime.now()

            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)

            return row.to_pydantic()

    async def delete_team(self, team_id: str) -> bool:
        """Delete a team."""
        async with get_session(self._db_url) as session:
            result = await session.execute(delete(TeamModel).where(TeamModel.id == team_id))
            return result.rowcount > 0  # type: ignore[union-attr]

    # ================================================================
    # Agents
    # ================================================================

    async def create_agent(self, team_id: str, name: str, role: str, **kwargs: object) -> Agent:
        """Create an Agent."""
        agent = Agent(
            team_id=team_id,
            name=name,
            role=role,
            system_prompt=str(kwargs.get("system_prompt", "")),
            model=str(kwargs.get("model", "claude-opus-4-6")),
            config=kwargs.get("config", {}),  # type: ignore[arg-type]
            source=str(kwargs.get("source", "api")),
            session_id=kwargs.get("session_id"),  # type: ignore[arg-type]
            cc_tool_use_id=kwargs.get("cc_tool_use_id"),  # type: ignore[arg-type]
        )
        orm = AgentModel.from_pydantic(agent)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return agent

    async def get_agent(self, agent_id: str) -> Agent | None:
        """Get an Agent by ID."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(AgentModel).where(AgentModel.id == agent_id))
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def list_agents(self, team_id: str) -> list[Agent]:
        """List all Agents in a team."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(AgentModel)
                .where(AgentModel.team_id == team_id)
                .order_by(AgentModel.created_at)
            )
            stmt = self._apply_project_filter(stmt, AgentModel)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def update_agent(self, agent_id: str, **kwargs: object) -> Agent:
        """Update Agent information."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(AgentModel).where(AgentModel.id == agent_id))
            row = result.scalar_one_or_none()
            if row is None:
                msg = f"Agent {agent_id} 不存在"
                raise NotFoundError(msg)

            # Handle status field: convert to string value
            if "status" in kwargs:
                status_val = kwargs["status"]
                if isinstance(status_val, AgentStatus):
                    kwargs["status"] = status_val.value
                elif isinstance(status_val, str):
                    AgentStatus(status_val)

            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)

            updated = row.to_pydantic()

        # Auto-emit snapshot event after state change
        snapshot = {
            "status": updated.status.value if hasattr(updated.status, "value") else str(updated.status),
            "name": updated.name,
        }
        await self.create_event(
            event_type="agent.updated",
            source="repository",
            data={"agent_id": agent_id, "changes": list(kwargs.keys())},
            entity_id=agent_id,
            entity_type="agent",
            state_snapshot=snapshot,
        )
        return updated

    async def delete_agent(self, agent_id: str) -> bool:
        """Delete an Agent."""
        async with get_session(self._db_url) as session:
            result = await session.execute(delete(AgentModel).where(AgentModel.id == agent_id))
            return result.rowcount > 0  # type: ignore[union-attr]

    # ================================================================
    # Tasks
    # ================================================================

    async def create_task(
        self, team_id: str | None, title: str, description: str = "", **kwargs: object
    ) -> Task:
        """Create a task.

        team_id can be None (project-level task, not bound to a team).
        """
        # Build optional parameters
        optional: dict[str, object] = {}
        for key in (
            "assigned_to",
            "parent_id",
            "project_id",
            "depends_on",
            "depth",
            "order",
            "template_id",
            "priority",
            "horizon",
            "tags",
            "config",
        ):
            if key in kwargs:
                optional[key] = kwargs[key]
        # Set default values
        optional.setdefault("depends_on", [])
        optional.setdefault("depth", 0)
        optional.setdefault("order", 0)

        # Auto-fill project_id from scope if not explicitly provided
        if self._project_scope and not optional.get("project_id"):
            optional["project_id"] = self._project_scope

        task = Task(
            team_id=team_id,
            title=title,
            description=description,
            **optional,  # type: ignore[arg-type]
        )
        orm = TaskModel.from_pydantic(task)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return task

    async def list_subtasks(self, parent_id: str) -> list[Task]:
        """List all subtasks of a task, sorted by order."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(TaskModel)
                .where(TaskModel.parent_id == parent_id)
                .order_by(TaskModel.order, TaskModel.created_at)
            )
            stmt = self._apply_project_filter(stmt, TaskModel)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def get_task(self, task_id: str) -> Task | None:
        """Get a task by ID."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(TaskModel).where(TaskModel.id == task_id))
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def list_tasks(self, team_id: str, status: TaskStatus | None = None) -> list[Task]:
        """List team tasks, optionally filtered by status."""
        async with get_session(self._db_url) as session:
            stmt = select(TaskModel).where(TaskModel.team_id == team_id)
            stmt = self._apply_project_filter(stmt, TaskModel)
            if status is not None:
                stmt = stmt.where(TaskModel.status == status.value)
            stmt = stmt.order_by(TaskModel.created_at.desc())
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def list_tasks_by_project(
        self, project_id: str, status: TaskStatus | None = None
    ) -> list[Task]:
        """List all tasks under a project (including project-level tasks with team_id=None and team tasks)."""
        async with get_session(self._db_url) as session:
            stmt = select(TaskModel).where(TaskModel.project_id == project_id)
            if status is not None:
                stmt = stmt.where(TaskModel.status == status.value)
            stmt = stmt.order_by(TaskModel.created_at.desc())
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def update_task(self, task_id: str, **kwargs: object) -> Task:
        """Update task information."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(TaskModel).where(TaskModel.id == task_id))
            row = result.scalar_one_or_none()
            if row is None:
                msg = f"任务 {task_id} 不存在"
                raise NotFoundError(msg)

            # Handle status field: convert to string value
            if "status" in kwargs:
                status_val = kwargs["status"]
                if isinstance(status_val, TaskStatus):
                    kwargs["status"] = status_val.value
                elif isinstance(status_val, str):
                    TaskStatus(status_val)

            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)

            updated = row.to_pydantic()

        # Auto-emit snapshot event after state change
        snapshot = {
            "status": updated.status.value if hasattr(updated.status, "value") else str(updated.status),
            "assigned_to": updated.assigned_to,
            "title": updated.title,
        }
        await self.create_event(
            event_type="task.updated",
            source="repository",
            data={"task_id": task_id, "changes": list(kwargs.keys())},
            entity_id=task_id,
            entity_type="task",
            state_snapshot=snapshot,
        )
        return updated

    async def get_downstream_tasks(self, task_id: str) -> list[Task]:
        """Find all tasks whose depends_on contains task_id (i.e., downstream tasks depending on this task)."""
        async with get_session(self._db_url) as session:
            # SQL LIKE pre-filter to narrow down results, then Python-level precise check on JSON array
            stmt = select(TaskModel).where(
                TaskModel.depends_on.cast(SAString).contains(task_id),
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            downstream = []
            for row in rows:
                deps = row.depends_on if isinstance(row.depends_on, list) else []
                if task_id in deps:
                    downstream.append(row.to_pydantic())
            return downstream

    async def resolve_task_dependencies(self, task_id: str) -> list[Task]:
        """Cascade unlock when a task completes.

        Check all downstream BLOCKED tasks that depend on this task_id.
        If all their dependencies are completed, unlock them to PENDING.

        Returns:
            List of unblocked tasks.
        """
        downstream = await self.get_downstream_tasks(task_id)
        blocked = [t for t in downstream if t.status == TaskStatus.BLOCKED]
        if not blocked:
            return []

        # Collect all dep IDs we need to check in one batch query
        all_dep_ids: set[str] = set()
        for task in blocked:
            all_dep_ids.update(task.depends_on)

        # Batch-load all dependency tasks with a single IN query
        dep_status: dict[str, str] = {}
        if all_dep_ids:
            async with get_session(self._db_url) as session:
                stmt = select(TaskModel).where(TaskModel.id.in_(all_dep_ids))
                result = await session.execute(stmt)
                for row in result.scalars().all():
                    dep_status[row.id] = row.status

        unblocked: list[Task] = []
        for task in blocked:
            all_deps_done = all(
                dep_status.get(dep_id) == TaskStatus.COMPLETED
                for dep_id in task.depends_on
            )
            if all_deps_done:
                updated = await self.update_task(task.id, status=TaskStatus.PENDING.value)
                unblocked.append(updated)

        return unblocked

    async def detect_dependency_cycle(self, task_id: str, new_dep_id: str) -> bool:
        """Detect if adding a dependency would create a cycle.

        Starting from new_dep_id, trace upstream along the depends_on chain.
        If it leads back to task_id, a cycle would be formed.

        Uses BFS with batch IN queries to avoid N+1 per traversal level.

        Returns:
            True if a cycle exists, False if safe.
        """
        # Self-dependency is a direct cycle
        if task_id == new_dep_id:
            return True

        visited: set[str] = set()
        frontier: set[str] = {new_dep_id}

        while frontier:
            to_fetch = frontier - visited
            if not to_fetch:
                break
            visited.update(to_fetch)

            # Batch-load all frontier nodes in a single IN query
            async with get_session(self._db_url) as session:
                stmt = select(TaskModel).where(TaskModel.id.in_(to_fetch))
                result = await session.execute(stmt)
                rows = result.scalars().all()

            next_frontier: set[str] = set()
            for row in rows:
                deps = row.depends_on if isinstance(row.depends_on, list) else []
                for dep_id in deps:
                    if dep_id == task_id:
                        return True  # Cycle found
                    if dep_id not in visited:
                        next_frontier.add(dep_id)

            frontier = next_frontier

        return False

    # ================================================================
    # Events
    # ================================================================

    async def create_event(
        self,
        event_type: str,
        source: str,
        data: dict,
        entity_id: str | None = None,
        entity_type: str | None = None,
        state_snapshot: dict | None = None,
    ) -> Event:
        """Create a system event.

        Args:
            event_type: Event type string (e.g. "task.created").
            source: Event source identifier.
            data: Full event payload.
            entity_id: ID of the primary entity involved (task/agent/team/meeting).
            entity_type: Entity type label: "task" / "agent" / "team" / "meeting".
            state_snapshot: Trimmed key fields of entity state at event time.
        """
        event = Event(
            type=EventType(event_type),
            source=source,
            data=data,
            entity_id=entity_id,
            entity_type=entity_type,
            state_snapshot=state_snapshot,
        )
        orm = EventModel.from_pydantic(event)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return event

    async def list_events(
        self,
        event_type: str | None = None,
        source: str | None = None,
        limit: int = 50,
        type_prefix: str | None = None,
        entity_id: str | None = None,
        team_ids: list[str] | None = None,
    ) -> list[Event]:
        """List events, optionally filtered by type, source, entity_id, or team scope.

        Args:
            event_type: Exact match on event type (e.g., "agent.created")
            source: Exact match on event source
            limit: Maximum number of results to return
            type_prefix: Prefix match on event type (e.g., "decision." matches all decision events)
            entity_id: Filter by entity ID — returns all events for a specific entity
            team_ids: Restrict to events whose entity_id belongs to one of these teams
        """
        async with get_session(self._db_url) as session:
            stmt = select(EventModel)
            if event_type is not None:
                stmt = stmt.where(EventModel.type == event_type)
            elif type_prefix is not None:
                stmt = stmt.where(EventModel.type.like(f"{type_prefix}%"))
            if source is not None:
                stmt = stmt.where(EventModel.source == source)
            if entity_id is not None:
                stmt = stmt.where(EventModel.entity_id == entity_id)
            if team_ids is not None:
                # Filter events associated with teams in this project
                # Events store the team ID in entity_id when entity_type='team'
                if team_ids:
                    stmt = stmt.where(EventModel.entity_id.in_(team_ids))
                else:
                    # Project has no teams — return empty
                    return []
            stmt = stmt.order_by(EventModel.timestamp.desc()).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Memories
    # ================================================================

    async def create_memory(
        self,
        scope: str,
        scope_id: str,
        content: str,
        metadata: dict | None = None,
    ) -> Memory:
        """Create a memory."""
        memory = Memory(
            scope=MemoryScope(scope),
            scope_id=scope_id,
            content=content,
            metadata=metadata or {},
        )
        orm = MemoryModel.from_pydantic(memory)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return memory

    async def get_memory(self, memory_id: str) -> Memory | None:
        """Get a memory by ID."""
        async with get_session(self._db_url) as session:
            result = await session.execute(select(MemoryModel).where(MemoryModel.id == memory_id))
            row = result.scalar_one_or_none()
            if row is not None:
                # Update access time
                row.accessed_at = datetime.now()
                return row.to_pydantic()
            return None

    async def list_memories(self, scope: str, scope_id: str) -> list[Memory]:
        """List all memories within the specified scope."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(MemoryModel)
                .where(
                    MemoryModel.scope == scope,
                    MemoryModel.scope_id == scope_id,
                )
                .order_by(MemoryModel.created_at.desc())
            )
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def search_memories(
        self, scope: str, scope_id: str, query: str, limit: int = 5
    ) -> list[Memory]:
        """Search memories (M1 phase uses simple LIKE keyword matching)."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(MemoryModel)
                .where(
                    MemoryModel.scope == scope,
                    MemoryModel.scope_id == scope_id,
                    MemoryModel.content.ilike(
                        "%{}%".format(query.replace("%", "\\%").replace("_", "\\_")),
                    ),
                )
                .order_by(MemoryModel.created_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def delete_memory(self, memory_id: str) -> bool:
        """Delete a memory."""
        async with get_session(self._db_url) as session:
            result = await session.execute(delete(MemoryModel).where(MemoryModel.id == memory_id))
            return result.rowcount > 0  # type: ignore[union-attr]

    async def list_team_knowledge(
        self,
        team_id: str,
        memory_type: str | None = None,
        limit: int = 50,
    ) -> list[Memory]:
        """List team knowledge base (memories with scope=team), with optional type filtering.

        Args:
            team_id: Team ID
            memory_type: Optional type filter, matches metadata.type field
                         e.g., failure_alchemy / lesson_learned / loop_review
            limit: Maximum number of results to return
        """
        async with get_session(self._db_url) as session:
            stmt = (
                select(MemoryModel)
                .where(
                    MemoryModel.scope == MemoryScope.TEAM.value,
                    MemoryModel.scope_id == team_id,
                )
                .order_by(MemoryModel.created_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            memories = [r.to_pydantic() for r in rows]

        if memory_type:
            memories = [m for m in memories if m.metadata.get("type") == memory_type]
        return memories

    async def list_agent_experience(
        self,
        agent_id: str,
        limit: int = 50,
    ) -> list[Memory]:
        """List an Agent's experience memories (scope=agent).

        Args:
            agent_id: Agent ID
            limit: Maximum number of results to return
        """
        async with get_session(self._db_url) as session:
            stmt = (
                select(MemoryModel)
                .where(
                    MemoryModel.scope == MemoryScope.AGENT.value,
                    MemoryModel.scope_id == agent_id,
                )
                .order_by(MemoryModel.created_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Meetings
    # ================================================================

    async def create_meeting(
        self,
        team_id: str,
        topic: str,
        participants: list[str] | None = None,
        meta_json: dict | None = None,
    ) -> Meeting:
        """Create a meeting."""
        meeting = Meeting(
            team_id=team_id,
            topic=topic,
            participants=participants or [],
            meta_json=meta_json or {},
        )
        orm = MeetingModel.from_pydantic(meeting)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return meeting

    async def get_meeting(self, meeting_id: str) -> Meeting | None:
        """Get a meeting by ID."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(MeetingModel).where(MeetingModel.id == meeting_id)
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def list_meetings(
        self,
        team_id: str,
        status: MeetingStatus | None = None,
    ) -> list[Meeting]:
        """List team meetings, optionally filtered by status."""
        async with get_session(self._db_url) as session:
            stmt = select(MeetingModel).where(MeetingModel.team_id == team_id)
            stmt = self._apply_project_filter(stmt, MeetingModel)
            if status is not None:
                stmt = stmt.where(MeetingModel.status == status.value)
            stmt = stmt.order_by(MeetingModel.created_at.desc())
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def update_meeting(self, meeting_id: str, **kwargs: object) -> Meeting:
        """Update meeting information."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(MeetingModel).where(MeetingModel.id == meeting_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                msg = f"会议 {meeting_id} 不存在"
                raise NotFoundError(msg)

            # Handle status field: convert to string value
            if "status" in kwargs:
                status_val = kwargs["status"]
                if isinstance(status_val, MeetingStatus):
                    kwargs["status"] = status_val.value
                elif isinstance(status_val, str):
                    MeetingStatus(status_val)

            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)

            return row.to_pydantic()

    async def create_meeting_message(
        self,
        meeting_id: str,
        agent_id: str,
        agent_name: str,
        content: str,
        round_number: int = 1,
        msg_metadata: dict | None = None,
    ) -> MeetingMessage:
        """Create a meeting message."""
        message = MeetingMessage(
            meeting_id=meeting_id,
            agent_id=agent_id,
            agent_name=agent_name,
            content=content,
            round_number=round_number,
            msg_metadata=msg_metadata or {},
        )
        orm = MeetingMessageModel.from_pydantic(message)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return message

    async def list_meeting_messages(
        self,
        meeting_id: str,
        limit: int = 100,
    ) -> list[MeetingMessage]:
        """List meeting messages."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(MeetingMessageModel)
                .where(MeetingMessageModel.meeting_id == meeting_id)
                .order_by(MeetingMessageModel.timestamp)
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def get_expired_meetings(self, hours: int = 24) -> list[Meeting]:
        """Get active meetings with no new messages for more than the specified hours.

        Determination logic:
        - Meetings with messages: last message timestamp is more than `hours` ago
        - Meetings without messages: creation time is more than `hours` ago
        """
        cutoff = datetime.now() - timedelta(hours=hours)
        async with get_session(self._db_url) as session:
            # Subquery: last message time for each meeting
            last_msg_subq = (
                select(
                    MeetingMessageModel.meeting_id,
                    func.max(MeetingMessageModel.timestamp).label("last_msg_time"),
                )
                .group_by(MeetingMessageModel.meeting_id)
                .subquery()
            )

            # Main query: active meetings LEFT JOIN last message time
            stmt = (
                select(MeetingModel)
                .outerjoin(
                    last_msg_subq,
                    MeetingModel.id == last_msg_subq.c.meeting_id,
                )
                .where(
                    MeetingModel.status == MeetingStatus.ACTIVE.value,
                    # Use last message time if available, otherwise use creation time
                    func.coalesce(
                        last_msg_subq.c.last_msg_time,
                        MeetingModel.created_at,
                    )
                    < cutoff,
                )
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def conclude_meeting(self, meeting_id: str) -> Meeting | None:
        """Conclude a meeting, setting its status to concluded."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(MeetingModel).where(MeetingModel.id == meeting_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            row.status = MeetingStatus.CONCLUDED.value
            row.concluded_at = datetime.now()
            return row.to_pydantic()

    # ================================================================
    # Hooks — CC session-related queries
    # ================================================================

    async def find_agent_by_session(
        self,
        session_id: str,
        agent_name: str,
    ) -> Agent | None:
        """Find a registered Agent by CC session ID and Agent name."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(AgentModel)
                .where(
                    AgentModel.session_id == session_id,
                    AgentModel.name == agent_name,
                )
                .limit(1)
            )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def find_agents_by_session(self, session_id: str) -> list[Agent]:
        """Find all Agents associated with a CC session."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(AgentModel)
                .where(AgentModel.session_id == session_id)
                .order_by(AgentModel.created_at)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def find_agent_by_cc_id(self, cc_agent_id: str) -> Agent | None:
        """Find an Agent by CC internal agent_id."""
        async with get_session(self._db_url) as session:
            stmt = select(AgentModel).where(AgentModel.cc_tool_use_id == cc_agent_id).limit(1)
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def find_agents_by_role(self, role: str) -> list[Agent]:
        """Find all Agents by role (across teams)."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(AgentModel)
                .where(AgentModel.role == role)
                .order_by(AgentModel.created_at.desc())
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def count_agents_by_source(
        self,
        source: str,
        session_id: str | None = None,
    ) -> int:
        """Count Agents by source, optionally filtered by session."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(func.count())
                .select_from(AgentModel)
                .where(
                    AgentModel.source == source,
                )
            )
            if session_id is not None:
                stmt = stmt.where(AgentModel.session_id == session_id)
            result = await session.execute(stmt)
            return result.scalar_one()

    # ================================================================
    # Agent Activities — tool call activity logs
    # ================================================================

    async def create_activity(
        self,
        agent_id: str,
        session_id: str,
        tool_name: str,
        input_summary: str = "",
        output_summary: str = "",
        status: str = "completed",
        duration_ms: int | None = None,
        error: str | None = None,
    ) -> AgentActivity:
        """Record a single tool call activity for an Agent."""
        activity = AgentActivity(
            agent_id=agent_id,
            session_id=session_id,
            tool_name=tool_name,
            input_summary=input_summary[:500],
            output_summary=output_summary[:500],
            status=status,
            duration_ms=duration_ms,
            error=error,
        )
        orm = AgentActivityModel.from_pydantic(activity)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return activity

    async def find_running_activity(
        self,
        agent_id: str,
        session_id: str,
        tool_name: str,
    ) -> AgentActivity | None:
        """Find a matching running-status activity (Pre→Post correlation)."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(AgentActivityModel)
                .where(
                    AgentActivityModel.agent_id == agent_id,
                    AgentActivityModel.session_id == session_id,
                    AgentActivityModel.tool_name == tool_name,
                    AgentActivityModel.status == "running",
                )
                .order_by(AgentActivityModel.timestamp.desc())
                .limit(1)
            )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def update_activity(
        self,
        activity_id: str,
        **kwargs: Any,
    ) -> None:
        """Update activity fields (used by PostToolUse to backfill duration_ms/status/output)."""
        async with get_session(self._db_url) as session:
            stmt = select(AgentActivityModel).where(AgentActivityModel.id == activity_id)
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return
            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)
            session.add(row)

    async def list_activities(
        self,
        agent_id: str,
        limit: int = 50,
    ) -> list[AgentActivity]:
        """Get an Agent's activity log."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(AgentActivityModel)
                .where(AgentActivityModel.agent_id == agent_id)
                .order_by(AgentActivityModel.timestamp.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def list_activities_by_session(
        self,
        session_id: str,
        limit: int = 100,
    ) -> list[AgentActivity]:
        """Get all activities under a session."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(AgentActivityModel)
                .where(AgentActivityModel.session_id == session_id)
                .order_by(AgentActivityModel.timestamp.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def list_activities_by_team(
        self,
        team_id: str,
        agent_id: str | None = None,
        limit: int = 50,
    ) -> list[AgentActivity]:
        """Get activity logs for all agents under a team, sorted by timestamp descending."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(AgentActivityModel)
                .join(AgentModel, AgentActivityModel.agent_id == AgentModel.id)
                .where(AgentModel.team_id == team_id)
                .order_by(AgentActivityModel.timestamp.desc())
                .limit(limit)
            )
            if agent_id is not None:
                stmt = stmt.where(AgentActivityModel.agent_id == agent_id)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Analytics — aggregate statistics queries
    # ================================================================

    async def count_activities_by_tool(
        self,
        agent_id: str | None = None,
        team_id: str | None = None,
    ) -> list[dict]:
        """Count activities grouped by tool name."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(
                    AgentActivityModel.tool_name,
                    func.count().label("count"),
                )
                .group_by(AgentActivityModel.tool_name)
                .order_by(func.count().desc())
            )
            if agent_id is not None:
                stmt = stmt.where(AgentActivityModel.agent_id == agent_id)
            if team_id is not None:
                # Filter by team via agent table join
                stmt = stmt.join(
                    AgentModel,
                    AgentActivityModel.agent_id == AgentModel.id,
                ).where(AgentModel.team_id == team_id)

            result = await session.execute(stmt)
            return [{"tool_name": row.tool_name, "count": row.count} for row in result.all()]

    async def get_activity_timeline(
        self,
        team_id: str | None = None,
        hours: int = 24,
    ) -> list[dict]:
        """Count activities by hour (last N hours)."""
        cutoff = datetime.now() - timedelta(hours=hours)
        async with get_session(self._db_url) as session:
            # Use strftime to extract hour granularity (SQLite compatible)
            hour_expr = func.strftime("%Y-%m-%d %H:00", AgentActivityModel.timestamp)
            stmt = (
                select(
                    hour_expr.label("hour"),
                    func.count().label("count"),
                )
                .where(AgentActivityModel.timestamp >= cutoff)
                .group_by(hour_expr)
                .order_by(hour_expr)
            )
            if team_id is not None:
                stmt = stmt.join(
                    AgentModel,
                    AgentActivityModel.agent_id == AgentModel.id,
                ).where(AgentModel.team_id == team_id)

            result = await session.execute(stmt)
            return [{"hour": row.hour, "count": row.count} for row in result.all()]

    async def get_agent_productivity(
        self,
        team_id: str | None = None,
    ) -> list[dict]:
        """Productivity metrics per Agent: activity count, tool diversity, last active time."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(
                    AgentActivityModel.agent_id,
                    AgentModel.name.label("agent_name"),
                    func.count().label("activity_count"),
                    func.count(AgentActivityModel.tool_name.distinct()).label("tools_used"),
                    func.max(AgentActivityModel.timestamp).label("last_active"),
                )
                .join(
                    AgentModel,
                    AgentActivityModel.agent_id == AgentModel.id,
                )
                .group_by(AgentActivityModel.agent_id, AgentModel.name)
                .order_by(func.count().desc())
            )
            if team_id is not None:
                stmt = stmt.where(AgentModel.team_id == team_id)

            result = await session.execute(stmt)
            rows = result.all()

            return [
                {
                    "agent_id": row.agent_id,
                    "agent_name": row.agent_name or "unknown",
                    "activity_count": row.activity_count,
                    "tools_used": row.tools_used,
                    "last_active": row.last_active.isoformat() if row.last_active else None,
                }
                for row in rows
            ]

    async def get_task_completion_stats(
        self,
        team_id: str | None = None,
    ) -> dict:
        """Task completion rate and average completion time statistics."""
        async with get_session(self._db_url) as session:
            stmt = select(
                func.count().label("total"),
                func.sum(
                    case(
                        (TaskModel.status == TaskStatus.COMPLETED.value, 1),
                        else_=0,
                    )
                ).label("completed"),
                func.avg(
                    case(
                        (
                            TaskModel.completed_at.isnot(None),
                            func.julianday(TaskModel.completed_at)
                            - func.julianday(TaskModel.created_at),
                        ),
                        else_=None,
                    )
                ).label("avg_completion_days"),
            ).select_from(TaskModel)

            if team_id is not None:
                stmt = stmt.where(TaskModel.team_id == team_id)

            result = await session.execute(stmt)
            row = result.one()

            total = row.total or 0
            completed = row.completed or 0
            avg_days = row.avg_completion_days

            return {
                "total_tasks": total,
                "completed_tasks": completed,
                "completion_rate": round(completed / total, 4) if total > 0 else 0,
                "avg_completion_hours": round(avg_days * 24, 2) if avg_days else None,
            }

    async def get_agent_utilization(
        self,
        team_id: str | None = None,
    ) -> list[dict]:
        """Agent utilization: calculate active period ratio based on activity timestamps."""
        async with get_session(self._db_url) as session:
            # Query each Agent's activity time span and count (JOIN to get name, avoid N+1)
            stmt = (
                select(
                    AgentActivityModel.agent_id,
                    AgentModel.name.label("agent_name"),
                    func.count().label("activity_count"),
                    func.min(AgentActivityModel.timestamp).label("first_active"),
                    func.max(AgentActivityModel.timestamp).label("last_active"),
                    func.count(AgentActivityModel.tool_name.distinct()).label("tools_used"),
                )
                .join(
                    AgentModel,
                    AgentActivityModel.agent_id == AgentModel.id,
                )
                .group_by(AgentActivityModel.agent_id, AgentModel.name)
                .order_by(func.count().desc())
            )
            if team_id is not None:
                stmt = stmt.where(AgentModel.team_id == team_id)

            result = await session.execute(stmt)
            rows = result.all()

            output: list[dict] = []
            for row in rows:
                # Estimate utilization: activity density (activities per hour)
                span_hours = 0.0
                if row.first_active and row.last_active:
                    span = (row.last_active - row.first_active).total_seconds() / 3600
                    span_hours = max(span, 1.0)  # Minimum 1 hour

                utilization = round(row.activity_count / span_hours, 2) if span_hours > 0 else 0

                output.append(
                    {
                        "agent_id": row.agent_id,
                        "agent_name": row.agent_name or "unknown",
                        "activity_count": row.activity_count,
                        "tools_used": row.tools_used,
                        "span_hours": round(span_hours, 2),
                        "activities_per_hour": utilization,
                        "first_active": row.first_active.isoformat() if row.first_active else None,
                        "last_active": row.last_active.isoformat() if row.last_active else None,
                    }
                )
            return output

    # ================================================================
    # Cross-project messages — always in the global default DB
    # ================================================================

    async def create_cross_message(
        self,
        from_project_id: str,
        from_project_dir: str,
        to_project_id: str | None,
        sender_name: str,
        content: str,
        message_type: str = "notification",
        metadata: dict | None = None,
    ) -> CrossMessage:
        """Create a cross-project message.

        Args:
            from_project_id: Sender's 12-char project ID (from compute_project_id).
            from_project_dir: Sender's project directory path.
            to_project_id: Recipient's 12-char project ID, or None for broadcast.
            sender_name: Name of the sending agent / component.
            content: Message body.
            message_type: One of notification / request / response / broadcast.
            metadata: Optional extra data dict.

        Returns:
            Created CrossMessage Pydantic model.
        """
        msg = CrossMessage(
            from_project_id=from_project_id,
            from_project_dir=from_project_dir,
            to_project_id=to_project_id,
            sender_name=sender_name,
            content=content,
            message_type=CrossMessageType(message_type),
            metadata=metadata or {},
        )
        orm = CrossMessageModel.from_pydantic(msg)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return msg

    async def list_cross_messages(
        self,
        project_id: str,
        unread_only: bool = False,
        limit: int = 50,
    ) -> list[CrossMessage]:
        """List inbox messages for a project.

        Returns messages where to_project_id == project_id (direct)
        OR to_project_id IS NULL (broadcast), sorted newest-first.

        Args:
            project_id: Recipient project's 12-char ID.
            unread_only: If True, exclude messages that have been read.
            limit: Maximum number of results to return.

        Returns:
            List of CrossMessage sorted by created_at descending.
        """
        from sqlalchemy import or_

        async with get_session(self._db_url) as session:
            stmt = (
                select(CrossMessageModel)
                .where(
                    or_(
                        CrossMessageModel.to_project_id == project_id,
                        CrossMessageModel.to_project_id.is_(None),
                    )
                )
                .order_by(CrossMessageModel.created_at.desc())
                .limit(limit)
            )
            if unread_only:
                stmt = stmt.where(CrossMessageModel.read_at.is_(None))
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def mark_cross_message_read(self, message_id: str) -> CrossMessage | None:
        """Mark a cross-project message as read.

        Args:
            message_id: Message UUID.

        Returns:
            Updated CrossMessage, or None if not found.
        """
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(CrossMessageModel).where(CrossMessageModel.id == message_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            row.read_at = datetime.now()
            return row.to_pydantic()

    async def count_unread_cross_messages(self, project_id: str) -> int:
        """Count unread messages in a project's inbox (direct + broadcast).

        Args:
            project_id: Recipient project's 12-char ID.

        Returns:
            Number of unread messages.
        """
        from sqlalchemy import or_

        async with get_session(self._db_url) as session:
            stmt = (
                select(func.count())
                .select_from(CrossMessageModel)
                .where(
                    or_(
                        CrossMessageModel.to_project_id == project_id,
                        CrossMessageModel.to_project_id.is_(None),
                    ),
                    CrossMessageModel.read_at.is_(None),
                )
            )
            result = await session.execute(stmt)
            return result.scalar_one() or 0

    # ================================================================
    # Scheduled Tasks
    # ================================================================

    async def create_scheduled_task(
        self,
        name: str,
        interval_seconds: int,
        action_type: str,
        next_run_at: datetime,
        team_id: str | None = None,
        description: str = "",
        action_config: dict | None = None,
    ) -> ScheduledTask:
        """Create a scheduled task."""
        task = ScheduledTask(
            team_id=team_id,
            name=name,
            description=description,
            interval_seconds=interval_seconds,
            action_type=action_type,
            action_config=action_config or {},
            next_run_at=next_run_at,
        )
        orm = ScheduledTaskModel.from_pydantic(task)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return task

    async def list_scheduled_tasks(self, team_id: str | None = None) -> list[ScheduledTask]:
        """List scheduled tasks, optionally filtered by team_id."""
        async with get_session(self._db_url) as session:
            stmt = select(ScheduledTaskModel).order_by(ScheduledTaskModel.created_at.desc())
            if team_id is not None:
                stmt = stmt.where(ScheduledTaskModel.team_id == team_id)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def get_scheduled_task(self, task_id: str) -> ScheduledTask | None:
        """Get a scheduled task by ID."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(ScheduledTaskModel).where(ScheduledTaskModel.id == task_id)
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def update_scheduled_task(self, task_id: str, **kwargs: Any) -> ScheduledTask | None:
        """Update a scheduled task."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(ScheduledTaskModel).where(ScheduledTaskModel.id == task_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)
            return row.to_pydantic()

    async def delete_scheduled_task(self, task_id: str) -> bool:
        """Delete a scheduled task."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                delete(ScheduledTaskModel).where(ScheduledTaskModel.id == task_id)
            )
            return result.rowcount > 0  # type: ignore[union-attr]

    # ================================================================
    # Wake Sessions
    # ================================================================

    async def create_wake_session(
        self, scheduled_task_id: str, agent_name: str, team_id: str = ""
    ) -> WakeSession:
        """Create a new wake session record."""
        ws = WakeSession(
            scheduled_task_id=scheduled_task_id,
            agent_name=agent_name,
            team_id=team_id,
        )
        orm = WakeSessionModel.from_pydantic(ws)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return ws

    async def update_wake_session(self, session_id: str, **kwargs: Any) -> WakeSession | None:
        """Update wake session fields (finished_at, outcome, exit_code, etc)."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(WakeSessionModel).where(WakeSessionModel.id == session_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            for key, value in kwargs.items():
                if hasattr(row, key):
                    setattr(row, key, value)
            return row.to_pydantic()

    async def get_recent_wake_sessions(
        self, agent_name: str, limit: int = 30
    ) -> list[WakeSession]:
        """Get recent wake sessions for an agent, ordered by started_at desc."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(WakeSessionModel)
                .where(WakeSessionModel.agent_name == agent_name)
                .order_by(WakeSessionModel.started_at.desc())
                .limit(limit)
            )
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def get_consecutive_failures(self, agent_name: str) -> int:
        """Count consecutive real failures for an agent (circuit breaker logic).

        Only 'error' and 'timeout' count as failures. Skips like
        'skipped_triage', 'skipped_concurrent', 'cancelled' are ignored.
        """
        _failure_outcomes = {"error", "timeout"}
        sessions = await self.get_recent_wake_sessions(agent_name, limit=30)
        count = 0
        for s in sessions:
            if s.outcome in _failure_outcomes:
                count += 1
            elif s.outcome == "completed":
                break
            # skip non-failure, non-completed outcomes (triage skip, concurrent skip, etc.)
        return count

    async def has_actionable_tasks(self, agent_name: str) -> tuple[bool, str]:
        """Check if agent has pending/running tasks assigned to them."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(TaskModel).where(
                    TaskModel.assigned_to == agent_name,
                    TaskModel.status.in_(["pending", "running"]),
                )
            )
            tasks = result.scalars().all()
            if tasks:
                return True, f"{len(tasks)} actionable tasks"
            return False, "no actionable tasks"

    async def toggle_wake_agents(self, enabled: bool) -> int:
        """Enable/disable all wake_agent scheduled tasks. Returns count affected."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(ScheduledTaskModel).where(
                    ScheduledTaskModel.action_type == "wake_agent",
                    ScheduledTaskModel.enabled == (not enabled),
                )
            )
            tasks = result.scalars().all()
            for t in tasks:
                t.enabled = enabled
            await session.commit()
            return len(tasks)

    async def cleanup_old_sessions(self, days: int = 30) -> int:
        """Delete wake sessions older than specified days. Returns count deleted."""
        cutoff = datetime.now() - timedelta(days=days)
        async with get_session(self._db_url) as session:
            result = await session.execute(
                delete(WakeSessionModel).where(WakeSessionModel.started_at < cutoff)
            )
            return result.rowcount  # type: ignore[union-attr]

    async def get_due_tasks(self, now: datetime) -> list[ScheduledTask]:
        """Get all enabled scheduled tasks whose next_run_at <= now."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(ScheduledTaskModel).where(
                    ScheduledTaskModel.enabled == True,  # noqa: E712
                    ScheduledTaskModel.next_run_at <= now,
                )
            )
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Leader Briefings
    # ================================================================

    async def create_briefing(
        self,
        title: str,
        description: str = "",
        options: str = "",
        recommendation: str = "",
        urgency: str = "medium",
        project_id: str = "",
    ) -> LeaderBriefing:
        """Create a new leader briefing item."""
        briefing = LeaderBriefing(
            title=title,
            description=description,
            options=options,
            recommendation=recommendation,
            urgency=urgency,
            project_id=project_id,
        )
        orm = LeaderBriefingModel.from_pydantic(briefing)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return briefing

    async def list_briefings(
        self, status: str = "pending", project_id: str = ""
    ) -> list[LeaderBriefing]:
        """List briefing items, optionally filtered by status and project_id."""
        async with get_session(self._db_url) as session:
            conditions = []
            if status and status != "all":
                conditions.append(LeaderBriefingModel.status == status)
            if project_id:
                conditions.append(LeaderBriefingModel.project_id == project_id)
            stmt = select(LeaderBriefingModel).order_by(
                LeaderBriefingModel.created_at.desc()
            )
            # Apply universal project isolation
            stmt = self._apply_project_filter(stmt, LeaderBriefingModel)
            if conditions:
                stmt = stmt.where(*conditions)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def resolve_briefing(
        self, briefing_id: str, resolution: str, status: str = "resolved"
    ) -> LeaderBriefing | None:
        """Resolve a briefing item with user's decision."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(LeaderBriefingModel).where(LeaderBriefingModel.id == briefing_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            row.resolution = resolution
            row.status = status
            row.resolved_at = datetime.now()
            return row.to_pydantic()

    async def dismiss_briefing(self, briefing_id: str) -> LeaderBriefing | None:
        """Dismiss a briefing item without a resolution."""
        return await self.resolve_briefing(briefing_id, resolution="", status="dismissed")

    # ================================================================
    # Channel Messages (v1.0 P1-6)
    # ================================================================

    async def create_channel_message(
        self,
        channel: str,
        sender: str,
        content: str,
        mentions: list[str] | None = None,
        metadata: dict | None = None,
    ) -> ChannelMessage:
        """Create a channel message."""
        msg = ChannelMessage(
            channel=channel,
            sender=sender,
            content=content,
            mentions=mentions or [],
            metadata=metadata or {},
        )
        orm = ChannelMessageModel.from_pydantic(msg)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return msg

    async def list_channel_messages(
        self,
        channel: str,
        since: datetime | None = None,
        limit: int = 50,
    ) -> list[ChannelMessage]:
        """List messages in a channel, optionally filtered by since timestamp."""
        async with get_session(self._db_url) as session:
            stmt = (
                select(ChannelMessageModel)
                .where(ChannelMessageModel.channel == channel)
                .order_by(ChannelMessageModel.created_at.asc())
                .limit(limit)
            )
            if since is not None:
                stmt = stmt.where(ChannelMessageModel.created_at > since)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def list_channel_mentions(
        self,
        agent_name: str,
        limit: int = 50,
    ) -> list[ChannelMessage]:
        """List channel messages that mention a specific agent."""
        mention_tag = f"@{agent_name}"
        async with get_session(self._db_url) as session:
            # SQLite JSON contains check via LIKE on serialized JSON string
            stmt = (
                select(ChannelMessageModel)
                .where(
                    ChannelMessageModel.mentions.cast(SAString).contains(mention_tag)
                )
                .order_by(ChannelMessageModel.created_at.desc())
                .limit(limit)
            )
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ── Reports ────────────────────────────────────────────────

    async def create_report(self, report: Report) -> Report:
        """Create a new report."""
        async with get_session(self._db_url) as session:
            row = ReportModel.from_pydantic(report)
            session.add(row)
            return report

    async def get_report(self, report_id: str) -> Report | None:
        """Get a single report by ID."""
        async with get_session(self._db_url) as session:
            row = await session.get(ReportModel, report_id)
            return row.to_pydantic() if row else None

    async def list_reports(
        self,
        project_id: str = "",
        report_type: str = "",
        author: str = "",
        topic: str = "",
        limit: int = 50,
    ) -> list[Report]:
        """List reports with optional filters."""
        async with get_session(self._db_url) as session:
            stmt = select(ReportModel)
            if project_id:
                stmt = stmt.where(ReportModel.project_id == project_id)
            if report_type:
                stmt = stmt.where(ReportModel.report_type == report_type)
            if author:
                stmt = stmt.where(ReportModel.author == author)
            if topic:
                stmt = stmt.where(ReportModel.topic.contains(topic))
            stmt = stmt.order_by(ReportModel.created_at.desc()).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def delete_report(self, report_id: str) -> bool:
        """Delete a report."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                delete(ReportModel).where(ReportModel.id == report_id)
            )
            return result.rowcount > 0  # type: ignore[union-attr]

    async def delete_reports_by_project(self, project_id: str) -> int:
        """Delete all reports for a project."""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                delete(ReportModel).where(ReportModel.project_id == project_id)
            )
            return result.rowcount or 0  # type: ignore[union-attr]

    # ================================================================
    # Pipeline Storage (D2: append-only stage history)
    # ================================================================

    async def get_pipeline_state(self, task_id: str) -> PipelineState | None:
        """读取 task.config['pipeline'] 并反序列化为 PipelineState。

        不存在时返回 None，让调用方决策是否初始化。
        """
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(TaskModel).where(TaskModel.id == task_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                return None
            config = row.config if isinstance(row.config, dict) else {}
            pipeline_data = config.get("pipeline")
            if pipeline_data is None:
                return None
            return PipelineState(**pipeline_data)

    async def set_pipeline_state(
        self,
        task_id: str,
        clock: "Any | None" = None,
        **kwargs: Any,
    ) -> Task:
        """Merge kwargs 进 task.config['pipeline']，保留其余 config 字段。

        clock 参数供仓储逻辑使用（符合 Clock 协议），ORM 默认值仍用 lambda。
        当 kwargs 包含 stage_started_at=True 时，从 clock 取当前时间。
        """
        from aiteam.pipeline.clock import WallClock

        effective_clock = clock if clock is not None else WallClock()

        # Resolve sentinel: stage_started_at=True 表示"用 clock.now()"
        if kwargs.get("stage_started_at") is True:
            kwargs["stage_started_at"] = effective_clock.now()

        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(TaskModel).where(TaskModel.id == task_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                raise NotFoundError(f"Task {task_id} not found")

            config: dict[str, Any] = dict(row.config) if isinstance(row.config, dict) else {}
            pipeline_block: dict[str, Any] = dict(config.get("pipeline") or {})

            for key, value in kwargs.items():
                # datetime 序列化为 ISO string 存 JSON
                if hasattr(value, "isoformat"):
                    pipeline_block[key] = value.isoformat()
                else:
                    pipeline_block[key] = value

            config["pipeline"] = pipeline_block
            row.config = config
            return row.to_pydantic()

    async def append_stage_history(
        self,
        task_id: str,
        from_stage: str | None,
        to_stage: str,
        triggered_by: str = "manual",
        reason: str = "",
        clock: "Any | None" = None,
    ) -> StageTransition:
        """插入新行到 pipeline_stage_history（append-only，不暴露 update/delete）。

        clock 参数符合 Clock 协议，用于生成 transitioned_at。
        """
        from aiteam.pipeline.clock import WallClock

        effective_clock = clock if clock is not None else WallClock()

        transition = StageTransition(
            task_id=task_id,
            from_stage=from_stage,
            to_stage=to_stage,
            triggered_by=triggered_by,  # type: ignore[arg-type]
            reason=reason,
            transitioned_at=effective_clock.now(),
        )
        orm = PipelineStageHistoryModel.from_pydantic(transition)
        async with get_session(self._db_url) as session:
            session.add(orm)
        return transition

    async def read_stage_history(
        self, task_id: str, limit: int = 50
    ) -> list[StageTransition]:
        """按 transitioned_at 升序读取指定任务的 stage 转换历史。"""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(PipelineStageHistoryModel)
                .where(PipelineStageHistoryModel.task_id == task_id)
                .order_by(PipelineStageHistoryModel.transitioned_at)
                .limit(limit)
            )
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Ecosystem repo profiles
    # ================================================================

    def _effective_project_id(
        self, explicit: str | None
    ) -> str | None:
        """Resolve project_id used to scope ecosystem rows.

        Precedence: explicit argument > _project_scope (set on repo init) > None.
        Empty string is normalised to None so callers can pass "" to mean
        "no override".
        """
        if explicit:
            return explicit
        if self._project_scope:
            return self._project_scope
        return None

    async def upsert_ecosystem_profile(
        self,
        profile: EcosystemRepoProfile,
        project_id: str | None = None,
    ) -> None:
        """按 (project_id, repo_full_name) 唯一键 upsert 生态仓档案，更新动态字段。

        Args:
            profile: 待写入的生态仓档案 Pydantic 模型。
            project_id: 显式指定项目作用域；为空时回退到当前 repo 的 _project_scope，
                        最终 None 表示全局/未归属（兼容旧数据）。
        """
        import json
        from datetime import timezone

        now = profile.last_scanned_at
        effective_pid = self._effective_project_id(project_id) or profile.project_id
        # Stamp project_id back onto the Pydantic so from_pydantic carries it.
        if effective_pid and not profile.project_id:
            profile.project_id = effective_pid

        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoProfileModel).where(
                EcosystemRepoProfileModel.repo_full_name == profile.repo_full_name
            )
            if effective_pid is None:
                stmt = stmt.where(EcosystemRepoProfileModel.project_id.is_(None))
            else:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                session.add(EcosystemRepoProfileModel.from_pydantic(profile))
            else:
                # Update dynamic fields; preserve first_seen_at + project_id
                row.stars = profile.stars
                row.description = profile.description
                row.language = profile.language
                row.topics = json.dumps(profile.topics) if profile.topics else None
                row.homepage = profile.homepage
                row.last_commit_at = profile.last_commit_at
                row.needs_deep_review = profile.needs_deep_review
                row.relevance_category = profile.relevance_category
                row.relevance_score = profile.relevance_score
                row.one_line_summary = profile.one_line_summary
                row.last_scanned_at = now
                # Stage B 字段：动态可更新
                row.pushed_at = profile.pushed_at
                row.is_archived = profile.is_archived
                row.scan_run_id = profile.scan_run_id
                row.description_excerpt = profile.description_excerpt or ""

    async def search_ecosystem_profiles(
        self,
        keyword: str = "",
        topic: str = "",
        min_stars: int = 0,
        max_stars: int | None = None,
        needs_deep_review: bool | None = None,
        category: str = "",
        limit: int = 50,
        project_id: str | None = None,
    ) -> list[EcosystemRepoProfile]:
        """按字段筛选生态仓档案，支持关键词、topic、star 范围、深审标记。

        Args:
            project_id: 显式指定项目作用域；为空时由 _project_scope 自动注入。
        """
        from sqlalchemy import or_

        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoProfileModel)
            stmt = self._apply_project_filter(stmt, EcosystemRepoProfileModel)
            if project_id:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.project_id == project_id
                )

            if min_stars > 0:
                stmt = stmt.where(EcosystemRepoProfileModel.stars >= min_stars)
            if max_stars is not None and max_stars > 0:
                stmt = stmt.where(EcosystemRepoProfileModel.stars <= max_stars)
            if needs_deep_review is not None:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.needs_deep_review == needs_deep_review
                )
            if category:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.relevance_category == category
                )
            if keyword:
                kw = f"%{keyword}%"
                stmt = stmt.where(
                    or_(
                        EcosystemRepoProfileModel.name.ilike(kw),
                        EcosystemRepoProfileModel.description.ilike(kw),
                        EcosystemRepoProfileModel.one_line_summary.ilike(kw),
                        EcosystemRepoProfileModel.repo_full_name.ilike(kw),
                    )
                )
            if topic:
                tp = f"%{topic}%"
                stmt = stmt.where(EcosystemRepoProfileModel.topics.ilike(tp))

            stmt = stmt.order_by(EcosystemRepoProfileModel.stars.desc()).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def get_ecosystem_profile(
        self,
        repo_full_name: str,
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """按 repo_full_name 获取单个生态仓档案。

        Args:
            project_id: 显式作用域；为空回退到 _project_scope。
                若都为空则匹配 project_id IS NULL（全局行）。
        """
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoProfileModel).where(
                EcosystemRepoProfileModel.repo_full_name == repo_full_name
            )
            if effective_pid is None and self._project_scope == "":
                # No scope at all — return any (global lookup, used by
                # cross-project tooling and tests).
                pass
            elif effective_pid is None:
                stmt = stmt.where(EcosystemRepoProfileModel.project_id.is_(None))
            else:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def get_ecosystem_profile_by_id(
        self,
        repo_id: str,
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """按主键 id 获取单个生态仓档案。

        Args:
            project_id: 显式作用域；为空回退到 _project_scope。
                作用域非空时仅匹配同项目 id，避免跨项目泄露。
        """
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoProfileModel).where(
                EcosystemRepoProfileModel.id == repo_id
            )
            if effective_pid is not None:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    # ================================================================
    # Ecosystem deep reviews
    # ================================================================

    async def create_deep_review(
        self,
        review: EcosystemDeepReview,
        project_id: str | None = None,
    ) -> EcosystemDeepReview:
        """创建一份深扫报告记录。

        Args:
            project_id: 显式作用域；空时使用 _project_scope，再空时使用 review.project_id。
        """
        effective_pid = self._effective_project_id(project_id) or review.project_id
        if effective_pid and not review.project_id:
            review.project_id = effective_pid
        async with get_session(self._db_url) as session:
            session.add(EcosystemDeepReviewModel.from_pydantic(review))
        return review

    async def get_deep_review(
        self,
        review_id: str,
        project_id: str | None = None,
    ) -> EcosystemDeepReview | None:
        """按 id 获取深扫报告。

        Args:
            project_id: 显式作用域；空回退到 _project_scope，作用域非空时仅匹配同项目。
        """
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemDeepReviewModel).where(
                EcosystemDeepReviewModel.id == review_id
            )
            if effective_pid is not None:
                stmt = stmt.where(
                    EcosystemDeepReviewModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def update_deep_review(
        self,
        review_id: str,
        **fields: Any,
    ) -> EcosystemDeepReview | None:
        """部分更新深扫报告字段。fields 中的 enum 自动转 .value。

        - 若 fields 含 _project_id 关键字（service 显式传入），仅匹配同项目；
        - 否则若当前 repo 设置了 _project_scope，则只允许更新同项目下的行。
        """
        explicit_pid = fields.pop("_project_id", None)
        effective_pid = explicit_pid or self._effective_project_id(None)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemDeepReviewModel).where(
                EcosystemDeepReviewModel.id == review_id
            )
            if effective_pid is not None:
                stmt = stmt.where(
                    EcosystemDeepReviewModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return None
            for key, value in fields.items():
                if hasattr(value, "value"):
                    value = value.value  # noqa: PLW2901  # enum -> str
                if hasattr(row, key):
                    setattr(row, key, value)
            await session.flush()
            return row.to_pydantic()

    async def list_deep_reviews(
        self,
        repo_id: str = "",
        status: str = "",
        limit: int = 50,
        project_id: str | None = None,
    ) -> list[EcosystemDeepReview]:
        """按 repo_id 或 status 列出深扫报告。空字符串忽略对应过滤条件。

        Args:
            project_id: 显式作用域；空时由 _project_scope 自动注入。
        """
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemDeepReviewModel)
            stmt = self._apply_project_filter(stmt, EcosystemDeepReviewModel)
            if project_id:
                stmt = stmt.where(
                    EcosystemDeepReviewModel.project_id == project_id
                )
            if repo_id:
                stmt = stmt.where(EcosystemDeepReviewModel.repo_id == repo_id)
            if status:
                stmt = stmt.where(EcosystemDeepReviewModel.status == status)
            stmt = stmt.order_by(EcosystemDeepReviewModel.created_at.desc()).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Ecosystem tags
    # ================================================================

    async def upsert_tag(self, tag: EcosystemTag) -> EcosystemTag:
        """按 name 唯一键 upsert 标签。已存在则更新非主键字段。"""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(EcosystemTagModel).where(EcosystemTagModel.name == tag.name)
            )
            row = result.scalar_one_or_none()
            if row is None:
                session.add(EcosystemTagModel.from_pydantic(tag))
            else:
                row.aliases = tag.aliases
                row.category = tag.category.value
                row.description = tag.description
        return tag

    async def get_tag_by_name(self, name: str) -> EcosystemTag | None:
        """按名称获取标签。"""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(EcosystemTagModel).where(EcosystemTagModel.name == name)
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def get_tag(self, tag_id: str) -> EcosystemTag | None:
        """按 id 获取标签。"""
        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(EcosystemTagModel).where(EcosystemTagModel.id == tag_id)
            )
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def list_tags(
        self, category: str = "", limit: int = 200
    ) -> list[EcosystemTag]:
        """列出标签，可按 category 过滤。"""
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemTagModel)
            if category:
                stmt = stmt.where(EcosystemTagModel.category == category)
            stmt = stmt.order_by(EcosystemTagModel.name).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Ecosystem repo-tag associations
    # ================================================================

    async def add_repo_tag(
        self,
        repo_tag: EcosystemRepoTag,
        project_id: str | None = None,
    ) -> EcosystemRepoTag:
        """添加仓-标签关联，已存在则更新 confidence/source/agent_id（应用层 upsert）。

        Args:
            project_id: 显式作用域；空时回退到 _project_scope/repo_tag.project_id。
        """
        effective_pid = self._effective_project_id(project_id) or repo_tag.project_id
        if effective_pid and not repo_tag.project_id:
            repo_tag.project_id = effective_pid

        async with get_session(self._db_url) as session:
            result = await session.execute(
                select(EcosystemRepoTagModel).where(
                    EcosystemRepoTagModel.repo_id == repo_tag.repo_id,
                    EcosystemRepoTagModel.tag_id == repo_tag.tag_id,
                )
            )
            row = result.scalar_one_or_none()
            if row is None:
                session.add(EcosystemRepoTagModel.from_pydantic(repo_tag))
            else:
                row.confidence = repo_tag.confidence
                row.source = repo_tag.source.value
                row.agent_id = repo_tag.agent_id
                if effective_pid and not row.project_id:
                    row.project_id = effective_pid
        return repo_tag

    async def remove_repo_tag(
        self,
        repo_id: str,
        tag_id: str,
        project_id: str | None = None,
    ) -> bool:
        """移除仓-标签关联，返回是否实际删除了记录。"""
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoTagModel).where(
                EcosystemRepoTagModel.repo_id == repo_id,
                EcosystemRepoTagModel.tag_id == tag_id,
            )
            if effective_pid is not None:
                stmt = stmt.where(
                    EcosystemRepoTagModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return False
            await session.delete(row)
            return True

    async def delete_repo_tags_by_sources(
        self,
        repo_id: str,
        sources: list[str],
        project_id: str | None = None,
    ) -> int:
        """Bulk-delete a repo's tag associations whose source is in ``sources``.

        Used by ``apply_batch(replace_auto=True)`` to clear stale auto-generated
        tags before re-applying. ``MANUAL`` and other sources are preserved.

        Args:
            repo_id: Target EcosystemRepoProfile.id.
            sources: List of source values to delete (e.g. ["github_topic", "auto_rule"]).
            project_id: Explicit project scope; falls back to repository scope.

        Returns:
            Number of rows actually deleted.
        """
        if not sources:
            return 0
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoTagModel).where(
                EcosystemRepoTagModel.repo_id == repo_id,
                EcosystemRepoTagModel.source.in_(sources),
            )
            if effective_pid is not None:
                stmt = stmt.where(EcosystemRepoTagModel.project_id == effective_pid)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            for row in rows:
                await session.delete(row)
            return len(rows)

    async def list_repo_tags(
        self,
        repo_id: str = "",
        tag_id: str = "",
        limit: int = 200,
        project_id: str | None = None,
    ) -> list[EcosystemRepoTag]:
        """列出仓-标签关联，按 repo_id 或 tag_id 过滤。

        Args:
            project_id: 显式作用域；空时由 _project_scope 自动注入。
        """
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoTagModel)
            stmt = self._apply_project_filter(stmt, EcosystemRepoTagModel)
            if project_id:
                stmt = stmt.where(EcosystemRepoTagModel.project_id == project_id)
            if repo_id:
                stmt = stmt.where(EcosystemRepoTagModel.repo_id == repo_id)
            if tag_id:
                stmt = stmt.where(EcosystemRepoTagModel.tag_id == tag_id)
            stmt = stmt.order_by(EcosystemRepoTagModel.created_at.desc()).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Ecosystem relations (repo <-> repo)
    # ================================================================

    async def add_relation(
        self,
        relation: EcosystemRelation,
        project_id: str | None = None,
    ) -> EcosystemRelation:
        """添加仓与仓的引用关系。

        Args:
            project_id: 显式作用域；空时回退到 _project_scope/relation.project_id。
        """
        effective_pid = self._effective_project_id(project_id) or relation.project_id
        if effective_pid and not relation.project_id:
            relation.project_id = effective_pid
        async with get_session(self._db_url) as session:
            session.add(EcosystemRelationModel.from_pydantic(relation))
        return relation

    async def list_relations(
        self,
        from_repo_id: str = "",
        to_repo_id: str = "",
        relation_type: str = "",
        limit: int = 200,
        project_id: str | None = None,
    ) -> list[EcosystemRelation]:
        """列出仓-仓关联，按起点 / 终点 / 类型过滤。

        Args:
            project_id: 显式作用域；空时由 _project_scope 自动注入。
        """
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRelationModel)
            stmt = self._apply_project_filter(stmt, EcosystemRelationModel)
            if project_id:
                stmt = stmt.where(EcosystemRelationModel.project_id == project_id)
            if from_repo_id:
                stmt = stmt.where(EcosystemRelationModel.from_repo_id == from_repo_id)
            if to_repo_id:
                stmt = stmt.where(EcosystemRelationModel.to_repo_id == to_repo_id)
            if relation_type:
                stmt = stmt.where(EcosystemRelationModel.relation_type == relation_type)
            stmt = stmt.order_by(EcosystemRelationModel.created_at.desc()).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    async def remove_relation(
        self,
        relation_id: str,
        project_id: str | None = None,
    ) -> bool:
        """删除一条关联记录。"""
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRelationModel).where(
                EcosystemRelationModel.id == relation_id
            )
            if effective_pid is not None:
                stmt = stmt.where(
                    EcosystemRelationModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return False
            await session.delete(row)
            return True

    # ================================================================
    # Ecosystem scan runs
    # ================================================================

    async def create_scan_run(
        self,
        scan_run: EcosystemScanRun,
        project_id: str | None = None,
    ) -> EcosystemScanRun:
        """创建一次扫描批次记录。

        Args:
            project_id: 显式作用域；空时回退到 _project_scope / scan_run.project_id。
        """
        effective_pid = self._effective_project_id(project_id) or scan_run.project_id
        if effective_pid and not scan_run.project_id:
            scan_run.project_id = effective_pid
        async with get_session(self._db_url) as session:
            session.add(EcosystemScanRunModel.from_pydantic(scan_run))
        return scan_run

    async def get_scan_run(
        self,
        scan_run_id: str,
        project_id: str | None = None,
    ) -> EcosystemScanRun | None:
        """按 id 获取扫描批次。"""
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemScanRunModel).where(
                EcosystemScanRunModel.id == scan_run_id
            )
            if effective_pid is not None:
                stmt = stmt.where(
                    EcosystemScanRunModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def update_scan_run(
        self,
        scan_run_id: str,
        **fields: Any,
    ) -> EcosystemScanRun | None:
        """部分更新扫描批次字段。fields 中的 enum 自动转 .value。

        作用域非空时只允许更新同项目下的行。
        """
        effective_pid = self._effective_project_id(None)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemScanRunModel).where(
                EcosystemScanRunModel.id == scan_run_id
            )
            if effective_pid is not None:
                stmt = stmt.where(
                    EcosystemScanRunModel.project_id == effective_pid
                )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return None
            for key, value in fields.items():
                if hasattr(value, "value"):
                    value = value.value  # noqa: PLW2901
                if hasattr(row, key):
                    setattr(row, key, value)
            await session.flush()
            return row.to_pydantic()

    async def list_scan_runs(
        self,
        strategy: str = "",
        limit: int = 50,
        project_id: str | None = None,
    ) -> list[EcosystemScanRun]:
        """按 strategy 列出扫描批次，按 started_at 降序。

        Args:
            project_id: 显式作用域；空时由 _project_scope 自动注入。
        """
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemScanRunModel)
            stmt = self._apply_project_filter(stmt, EcosystemScanRunModel)
            if project_id:
                stmt = stmt.where(EcosystemScanRunModel.project_id == project_id)
            if strategy:
                stmt = stmt.where(EcosystemScanRunModel.strategy == strategy)
            stmt = stmt.order_by(EcosystemScanRunModel.started_at.desc()).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # Stage E: Ecosystem extended search & holistic detail
    # ================================================================

    async def search_ecosystem_profiles_extended(
        self,
        keyword: str = "",
        topic: str = "",
        min_stars: int = 0,
        max_stars: int | None = None,
        needs_deep_review: bool | None = None,
        category: str = "",
        language: str = "",
        pushed_after: datetime | None = None,
        is_archived: bool | None = None,
        tags: list[str] | None = None,
        tag_match_mode: str = "all",
        sort: str = "stars",
        limit: int = 50,
        offset: int = 0,
        project_id: str | None = None,
    ) -> tuple[list[EcosystemRepoProfile], int]:
        """Stage E 扩展检索：支持 tags / language / pushed_after / 多种排序。

        参数：
            tags: 标签名列表（按 EcosystemTag.name 匹配）。空 list / None 不过滤。
            tag_match_mode: "all"（默认，AND 语义，所有 tag 必须存在）/ "any"（OR 语义）。
            sort: "stars"（默认，stars desc）/ "recency"（pushed_at desc，nulls last）/ "relevance"（relevance_score desc）。
            offset: 分页偏移，配合 limit 实现翻页。

        返回 (profiles, total_count_before_limit)。
        """
        from sqlalchemy import and_, or_

        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoProfileModel)
            stmt = self._apply_project_filter(stmt, EcosystemRepoProfileModel)
            if project_id:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.project_id == project_id
                )

            # 基础字段过滤
            if min_stars > 0:
                stmt = stmt.where(EcosystemRepoProfileModel.stars >= min_stars)
            if max_stars is not None and max_stars > 0:
                stmt = stmt.where(EcosystemRepoProfileModel.stars <= max_stars)
            if needs_deep_review is not None:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.needs_deep_review == needs_deep_review
                )
            if category:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.relevance_category == category
                )
            if language:
                stmt = stmt.where(EcosystemRepoProfileModel.language == language)
            if pushed_after is not None:
                stmt = stmt.where(EcosystemRepoProfileModel.pushed_at >= pushed_after)
            if is_archived is not None:
                stmt = stmt.where(
                    EcosystemRepoProfileModel.is_archived == is_archived
                )
            if keyword:
                kw = f"%{keyword}%"
                stmt = stmt.where(
                    or_(
                        EcosystemRepoProfileModel.name.ilike(kw),
                        EcosystemRepoProfileModel.description.ilike(kw),
                        EcosystemRepoProfileModel.one_line_summary.ilike(kw),
                        EcosystemRepoProfileModel.repo_full_name.ilike(kw),
                        EcosystemRepoProfileModel.description_excerpt.ilike(kw),
                    )
                )
            if topic:
                tp = f"%{topic}%"
                stmt = stmt.where(EcosystemRepoProfileModel.topics.ilike(tp))

            # tags 过滤：通过 EXISTS subquery 实现 AND/OR
            if tags:
                # 解析 tag 名 -> tag_id
                tag_ids: list[str] = []
                tag_rows = await session.execute(
                    select(EcosystemTagModel).where(EcosystemTagModel.name.in_(tags))
                )
                for t in tag_rows.scalars().all():
                    tag_ids.append(t.id)

                if not tag_ids:
                    # 标签全不存在 -> 0 结果
                    return ([], 0)

                if tag_match_mode == "any":
                    # OR 语义：repo 至少有一个匹配标签
                    subq = (
                        select(EcosystemRepoTagModel.repo_id)
                        .where(EcosystemRepoTagModel.tag_id.in_(tag_ids))
                    )
                    stmt = stmt.where(EcosystemRepoProfileModel.id.in_(subq))
                else:
                    # AND 语义：每个 tag_id 都必须有对应 repo_tag 行
                    for tid in tag_ids:
                        subq = (
                            select(EcosystemRepoTagModel.repo_id)
                            .where(EcosystemRepoTagModel.tag_id == tid)
                        )
                        stmt = stmt.where(EcosystemRepoProfileModel.id.in_(subq))

            # 计算 total（offset/limit 之前）
            count_stmt = select(func.count()).select_from(stmt.subquery())
            total_result = await session.execute(count_stmt)
            total = int(total_result.scalar() or 0)

            # 排序
            if sort == "recency":
                # SQLite 的 NULLS LAST 兼容做法：is null asc + value desc
                stmt = stmt.order_by(
                    EcosystemRepoProfileModel.pushed_at.is_(None).asc(),
                    EcosystemRepoProfileModel.pushed_at.desc(),
                    EcosystemRepoProfileModel.stars.desc(),
                )
            elif sort == "relevance":
                stmt = stmt.order_by(
                    EcosystemRepoProfileModel.relevance_score.desc(),
                    EcosystemRepoProfileModel.stars.desc(),
                )
            else:  # default "stars"
                stmt = stmt.order_by(EcosystemRepoProfileModel.stars.desc())

            stmt = stmt.offset(max(offset, 0)).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return ([r.to_pydantic() for r in rows], total)

    async def compute_ecosystem_facet_counts(
        self,
        keyword: str = "",
        min_stars: int = 0,
        max_stars: int | None = None,
        category: str = "",
        language: str = "",
        is_archived: bool | None = None,
        project_id: str | None = None,
    ) -> dict[str, dict[str, int]]:
        """计算 facet 聚合：在给定基础筛选下，统计 category / language / archived 的分布。

        返回 {"category": {...}, "language": {...}, "archived": {"true": n, "false": n}}。

        K1 perf: 三个 GROUP BY 共享一个 session + 单一 ``_apply_filters`` helper
        消除原版的 cat_stmt dead-code 和 5 段重复 ``or_(...)``。GROUP BY 在 SQL 层
        聚合比 fetch 全行后 Python 聚合在大表上更快（实测 50K 行 GROUP BY 132ms
        vs Python 全 fetch 152ms）。
        """
        from sqlalchemy import or_

        effective_pid = self._effective_project_id(project_id)

        def _apply_filters(q):
            """Apply common filters (project + stars + cat/lang/archived + keyword)."""
            if effective_pid is not None:
                q = q.where(
                    EcosystemRepoProfileModel.project_id == effective_pid
                )
            if min_stars > 0:
                q = q.where(EcosystemRepoProfileModel.stars >= min_stars)
            if max_stars is not None and max_stars > 0:
                q = q.where(EcosystemRepoProfileModel.stars <= max_stars)
            if category:
                q = q.where(
                    EcosystemRepoProfileModel.relevance_category == category
                )
            if language:
                q = q.where(EcosystemRepoProfileModel.language == language)
            if is_archived is not None:
                q = q.where(
                    EcosystemRepoProfileModel.is_archived == is_archived
                )
            if keyword:
                kw = f"%{keyword}%"
                q = q.where(
                    or_(
                        EcosystemRepoProfileModel.name.ilike(kw),
                        EcosystemRepoProfileModel.description.ilike(kw),
                        EcosystemRepoProfileModel.one_line_summary.ilike(kw),
                        EcosystemRepoProfileModel.repo_full_name.ilike(kw),
                        EcosystemRepoProfileModel.description_excerpt.ilike(kw),
                    )
                )
            return q

        async with get_session(self._db_url) as session:
            cat_q = _apply_filters(
                select(
                    EcosystemRepoProfileModel.relevance_category,
                    func.count(EcosystemRepoProfileModel.id).label("cnt"),
                )
            ).group_by(EcosystemRepoProfileModel.relevance_category)
            cat_result = await session.execute(cat_q)
            category_counts: dict[str, int] = {}
            for row in cat_result.all():
                key = row[0] or "unknown"
                category_counts[key] = int(row[1])

            lang_q = _apply_filters(
                select(
                    EcosystemRepoProfileModel.language,
                    func.count(EcosystemRepoProfileModel.id).label("cnt"),
                )
            ).group_by(EcosystemRepoProfileModel.language)
            lang_result = await session.execute(lang_q)
            language_counts: dict[str, int] = {}
            for row in lang_result.all():
                key = row[0] or "unknown"
                language_counts[key] = int(row[1])

            arch_q = _apply_filters(
                select(
                    EcosystemRepoProfileModel.is_archived,
                    func.count(EcosystemRepoProfileModel.id).label("cnt"),
                )
            ).group_by(EcosystemRepoProfileModel.is_archived)
            arch_result = await session.execute(arch_q)
            archived_counts: dict[str, int] = {"true": 0, "false": 0}
            for row in arch_result.all():
                key = "true" if row[0] else "false"
                archived_counts[key] = int(row[1])

            return {
                "category": category_counts,
                "language": language_counts,
                "archived": archived_counts,
            }

    async def get_ecosystem_profile_full(
        self,
        repo_full_name: str = "",
        repo_id: str = "",
        relations_limit: int = 50,
        deep_reviews_limit: int = 20,
        project_id: str | None = None,
    ) -> dict[str, Any] | None:
        """全息获取仓档案：profile + tags(含名称) + deep_reviews + relations(from/to) + scan_run。

        repo_full_name 与 repo_id 二选一（repo_id 优先）。
        返回 None 当仓不存在。

        Args:
            project_id: 显式作用域；空时由 _project_scope 自动注入。
        """
        # 1) 主档案
        profile: EcosystemRepoProfile | None = None
        if repo_id:
            profile = await self.get_ecosystem_profile_by_id(
                repo_id, project_id=project_id
            )
        elif repo_full_name:
            profile = await self.get_ecosystem_profile(
                repo_full_name, project_id=project_id
            )
        if profile is None:
            return None

        # 2) tags（join EcosystemTag 取名称 + category）
        async with get_session(self._db_url) as session:
            tag_join = await session.execute(
                select(EcosystemRepoTagModel, EcosystemTagModel)
                .join(
                    EcosystemTagModel,
                    EcosystemTagModel.id == EcosystemRepoTagModel.tag_id,
                )
                .where(EcosystemRepoTagModel.repo_id == profile.id)
                .order_by(EcosystemTagModel.name)
            )
            tags_payload: list[dict[str, Any]] = []
            for repo_tag, tag in tag_join.all():
                tags_payload.append(
                    {
                        "tag_id": tag.id,
                        "name": tag.name,
                        "category": tag.category,
                        "aliases": tag.aliases or [],
                        "description": tag.description,
                        "confidence": repo_tag.confidence,
                        "source": repo_tag.source,
                        "agent_id": repo_tag.agent_id,
                        "created_at": (
                            repo_tag.created_at.isoformat()
                            if repo_tag.created_at
                            else None
                        ),
                    }
                )

        # 3) deep reviews（带 project 作用域）
        deep_reviews = await self.list_deep_reviews(
            repo_id=profile.id,
            limit=deep_reviews_limit,
            project_id=project_id,
        )

        # 4) relations from + to（含目标仓简要信息）
        async with get_session(self._db_url) as session:
            from_rows = await session.execute(
                select(EcosystemRelationModel, EcosystemRepoProfileModel)
                .outerjoin(
                    EcosystemRepoProfileModel,
                    EcosystemRepoProfileModel.id
                    == EcosystemRelationModel.to_repo_id,
                )
                .where(EcosystemRelationModel.from_repo_id == profile.id)
                .order_by(EcosystemRelationModel.created_at.desc())
                .limit(relations_limit)
            )
            relations_from: list[dict[str, Any]] = []
            for rel, target in from_rows.all():
                relations_from.append(
                    {
                        "relation_id": rel.id,
                        "relation_type": rel.relation_type,
                        "to_repo_id": rel.to_repo_id,
                        "to_repo_full_name": (
                            target.repo_full_name if target else None
                        ),
                        "to_repo_stars": target.stars if target else None,
                        "evidence": rel.evidence,
                        "confidence": rel.confidence,
                        "agent_id": rel.agent_id,
                    }
                )

            to_rows = await session.execute(
                select(EcosystemRelationModel, EcosystemRepoProfileModel)
                .outerjoin(
                    EcosystemRepoProfileModel,
                    EcosystemRepoProfileModel.id
                    == EcosystemRelationModel.from_repo_id,
                )
                .where(EcosystemRelationModel.to_repo_id == profile.id)
                .order_by(EcosystemRelationModel.created_at.desc())
                .limit(relations_limit)
            )
            relations_to: list[dict[str, Any]] = []
            for rel, source in to_rows.all():
                relations_to.append(
                    {
                        "relation_id": rel.id,
                        "relation_type": rel.relation_type,
                        "from_repo_id": rel.from_repo_id,
                        "from_repo_full_name": (
                            source.repo_full_name if source else None
                        ),
                        "from_repo_stars": source.stars if source else None,
                        "evidence": rel.evidence,
                        "confidence": rel.confidence,
                        "agent_id": rel.agent_id,
                    }
                )

        # 5) scan_run（带 project 作用域）
        scan_run = None
        if profile.scan_run_id:
            scan_run = await self.get_scan_run(
                profile.scan_run_id, project_id=project_id
            )

        return {
            "profile": profile,
            "tags": tags_payload,
            "deep_reviews": deep_reviews,
            "relations_from": relations_from,
            "relations_to": relations_to,
            "scan_run": scan_run,
        }

    # ================================================================
    # Stage J: 项目隔离 backfill
    # ================================================================

    async def backfill_ecosystem_to_project(
        self, project_id: str
    ) -> dict[str, int]:
        """把所有 project_id IS NULL 的 ecosystem 数据迁移至指定项目。

        覆盖 5 张数据表：profiles / scan_runs / deep_reviews / repo_tags / relations。
        EcosystemTag 字典保持 NULL（全局共用）。

        幂等：已有 project_id 的行不动；只迁移 NULL 行。

        Args:
            project_id: 目标项目 id（必须存在于 projects 表）。

        Returns:
            每张表实际迁移行数的字典。
        """
        from sqlalchemy import update

        if not project_id:
            raise ValueError("project_id 不能为空")

        async with get_session(self._db_url) as session:
            # 校验目标项目存在
            existing_project = await session.execute(
                select(ProjectModel).where(ProjectModel.id == project_id)
            )
            if existing_project.scalar_one_or_none() is None:
                raise ValueError(f"项目 {project_id} 不存在")

            counts: dict[str, int] = {}
            tables = [
                ("ecosystem_repo_profiles", EcosystemRepoProfileModel),
                ("ecosystem_scan_runs", EcosystemScanRunModel),
                ("ecosystem_deep_reviews", EcosystemDeepReviewModel),
                ("ecosystem_repo_tags", EcosystemRepoTagModel),
                ("ecosystem_relations", EcosystemRelationModel),
            ]
            for label, model in tables:
                stmt = (
                    update(model)
                    .where(model.project_id.is_(None))
                    .values(project_id=project_id)
                )
                result = await session.execute(stmt)
                counts[label] = int(result.rowcount or 0)

            return counts

    # ================================================================
    # v1.5.0-A: Stage status helpers (DeepReview 渐进式漏斗)
    # ================================================================

    async def update_deep_review_stage(
        self,
        review_id: str,
        stage_status: EcosystemStageStatus | str,
        *,
        completed_at: datetime | None = None,
        debate_meeting_id: str | None = None,
        integration_task_id: str | None = None,
        integration_md: str | None = None,
        project_id: str | None = None,
    ) -> EcosystemDeepReview | None:
        """推进 DeepReview 的 stage_status，自动写对应阶段时间戳。

        Args:
            review_id: 目标 DeepReview id。
            stage_status: 新 stage 值；接受 enum 或字符串。
            completed_at: 阶段完成时间，默认当前 UTC 时间；用于回填历史时显式指定。
            debate_meeting_id: stage_status=DEBATED 时关联的会议 id。
            integration_task_id: stage_status=INTEGRATED 时关联的任务 id。
            integration_md: 集成建议的 markdown 内容。
            project_id: 显式作用域；空时由 _project_scope 自动注入。

        Returns:
            更新后的 DeepReview Pydantic 模型；找不到则返回 None。
        """
        if isinstance(stage_status, str):
            stage_status = EcosystemStageStatus(stage_status)

        ts = completed_at or datetime.now(tz=timezone.utc)

        # 不同阶段写入不同时间戳字段
        timestamp_fields: dict[str, datetime | None] = {}
        if stage_status == EcosystemStageStatus.SHALLOW_DONE:
            timestamp_fields["shallow_completed_at"] = ts
        elif stage_status == EcosystemStageStatus.ARCHITECTURE_DONE:
            timestamp_fields["architecture_completed_at"] = ts
        elif stage_status == EcosystemStageStatus.DEBATED:
            timestamp_fields["debated_at"] = ts
        elif stage_status in (
            EcosystemStageStatus.REFERENCED,
            EcosystemStageStatus.INTEGRATED,
        ):
            timestamp_fields["stage3_completed_at"] = ts

        update_kwargs: dict[str, Any] = {"stage_status": stage_status.value}
        update_kwargs.update(timestamp_fields)
        if debate_meeting_id is not None:
            update_kwargs["debate_meeting_id"] = debate_meeting_id
        if integration_task_id is not None:
            update_kwargs["integration_task_id"] = integration_task_id
        if integration_md is not None:
            update_kwargs["integration_md"] = integration_md
        if project_id is not None:
            update_kwargs["_project_id"] = project_id

        return await self.update_deep_review(review_id, **update_kwargs)

    async def list_deep_reviews_by_stage(
        self,
        stage_status: EcosystemStageStatus | str,
        repo_id: str = "",
        limit: int = 50,
        project_id: str | None = None,
    ) -> list[EcosystemDeepReview]:
        """按 stage_status 列出 deep reviews。

        v1.5.0 漏斗 UI/Worker 使用：例如查 ``shallow_done`` 的所有仓供 Stage 1
        候选展示，或查 ``shallow_failed`` 仓供 manual retry 列表。
        """
        if isinstance(stage_status, EcosystemStageStatus):
            stage_status = stage_status.value
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemDeepReviewModel)
            stmt = self._apply_project_filter(stmt, EcosystemDeepReviewModel)
            if project_id:
                stmt = stmt.where(EcosystemDeepReviewModel.project_id == project_id)
            stmt = stmt.where(EcosystemDeepReviewModel.stage_status == stage_status)
            if repo_id:
                stmt = stmt.where(EcosystemDeepReviewModel.repo_id == repo_id)
            stmt = stmt.order_by(EcosystemDeepReviewModel.created_at.desc()).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # v1.5.0-A: Failed flag helpers (Profile 失败追踪)
    # ================================================================

    async def mark_profile_deleted(
        self,
        repo_id: str,
        *,
        error_message: str = "",
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """把 profile 标为 GitHub 端被删除。

        - 设置 is_deleted=True / is_active=False；
        - 失败次数 +1，记最近错误消息；
        - lifecycle 标签由调用方另行 add_repo_tag('deleted', source='lifecycle')。
        """
        return await self._update_profile_failure_state(
            repo_id,
            is_deleted=True,
            is_active=False,
            last_fetch_error=error_message or "GitHub 404",
            project_id=project_id,
        )

    async def mark_profile_private(
        self,
        repo_id: str,
        *,
        error_message: str = "",
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """把 profile 标为 GitHub 端被设为私密 (403 forbidden, not rate limit)。"""
        return await self._update_profile_failure_state(
            repo_id,
            is_private_now=True,
            is_active=False,
            last_fetch_error=error_message or "GitHub 403 forbidden",
            project_id=project_id,
        )

    async def mark_profile_fetch_failure(
        self,
        repo_id: str,
        *,
        error_message: str,
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """记录一次抓取失败，failure_count +1。

        不切换 is_deleted/is_private/is_active；调用方根据错误类型决定是否升级到
        mark_profile_deleted/private。
        """
        return await self._update_profile_failure_state(
            repo_id,
            last_fetch_error=error_message,
            project_id=project_id,
            increment_failure=True,
        )

    async def clear_profile_failure(
        self,
        repo_id: str,
        *,
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """复活：抓取重新成功，清空失败状态 (decision §3.3 复活机制)。

        - is_deleted/is_private_now → False
        - is_active → True
        - last_fetch_error → ''
        - fetch_failure_count → 0
        """
        return await self._update_profile_failure_state(
            repo_id,
            is_deleted=False,
            is_private_now=False,
            is_active=True,
            last_fetch_error="",
            fetch_failure_count_reset=True,
            project_id=project_id,
        )

    async def _update_profile_failure_state(
        self,
        repo_id: str,
        *,
        is_deleted: bool | None = None,
        is_private_now: bool | None = None,
        is_active: bool | None = None,
        last_fetch_error: str | None = None,
        increment_failure: bool = False,
        fetch_failure_count_reset: bool = False,
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """内部统一入口，更新 profile 失败/活跃相关字段。"""
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoProfileModel).where(
                EcosystemRepoProfileModel.id == repo_id
            )
            if effective_pid is not None:
                stmt = stmt.where(EcosystemRepoProfileModel.project_id == effective_pid)
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return None
            if is_deleted is not None:
                row.is_deleted = is_deleted
            if is_private_now is not None:
                row.is_private_now = is_private_now
            if is_active is not None:
                row.is_active = is_active
            if last_fetch_error is not None:
                row.last_fetch_error = last_fetch_error
            if increment_failure:
                row.fetch_failure_count = (row.fetch_failure_count or 0) + 1
            if fetch_failure_count_reset:
                row.fetch_failure_count = 0
            await session.flush()
            return row.to_pydantic()

    async def update_profile_active_set(
        self,
        repo_id: str,
        *,
        is_active: bool,
        active_rank: int | None,
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """更新仓的活跃集状态 (recompute_active_set 内部用)。"""
        effective_pid = self._effective_project_id(project_id)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoProfileModel).where(
                EcosystemRepoProfileModel.id == repo_id
            )
            if effective_pid is not None:
                stmt = stmt.where(EcosystemRepoProfileModel.project_id == effective_pid)
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return None
            row.is_active = is_active
            row.active_rank = active_rank
            await session.flush()
            return row.to_pydantic()

    async def update_profile_shallow_summary(
        self,
        repo_id: str,
        *,
        shallow_summary: str,
        refreshed_at: datetime | None = None,
        project_id: str | None = None,
    ) -> EcosystemRepoProfile | None:
        """写入 Stage 0 浅扫总结，更新 last_shallow_refreshed_at。"""
        effective_pid = self._effective_project_id(project_id)
        ts = refreshed_at or datetime.now(tz=timezone.utc)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoProfileModel).where(
                EcosystemRepoProfileModel.id == repo_id
            )
            if effective_pid is not None:
                stmt = stmt.where(EcosystemRepoProfileModel.project_id == effective_pid)
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                return None
            row.shallow_summary = shallow_summary or ""
            row.last_shallow_refreshed_at = ts
            await session.flush()
            return row.to_pydantic()

    # ================================================================
    # v1.5.0-A: Status snapshot helpers (append-only 决策 D)
    # ================================================================

    async def create_status_snapshot(
        self,
        snapshot: EcosystemRepoStatusSnapshot,
        project_id: str | None = None,
    ) -> EcosystemRepoStatusSnapshot:
        """写入一条状态快照 (append-only)。

        Args:
            snapshot: 状态快照 Pydantic。
            project_id: 显式作用域；空时回退到 _project_scope/snapshot.project_id。
        """
        effective_pid = self._effective_project_id(project_id) or snapshot.project_id
        if effective_pid and not snapshot.project_id:
            snapshot.project_id = effective_pid
        async with get_session(self._db_url) as session:
            session.add(EcosystemRepoStatusSnapshotModel.from_pydantic(snapshot))
        return snapshot

    async def list_status_snapshots(
        self,
        repo_id: str = "",
        scan_run_id: str = "",
        limit: int = 100,
        project_id: str | None = None,
    ) -> list[EcosystemRepoStatusSnapshot]:
        """列出状态快照，按 snapshot_at 降序。

        参数：
            repo_id: 按仓过滤；空 = 不过滤。
            scan_run_id: 按 scan 批次过滤；空 = 不过滤。
            project_id: 显式作用域；空时由 _project_scope 自动注入。
        """
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemRepoStatusSnapshotModel)
            stmt = self._apply_project_filter(stmt, EcosystemRepoStatusSnapshotModel)
            if project_id:
                stmt = stmt.where(EcosystemRepoStatusSnapshotModel.project_id == project_id)
            if repo_id:
                stmt = stmt.where(EcosystemRepoStatusSnapshotModel.repo_id == repo_id)
            if scan_run_id:
                stmt = stmt.where(
                    EcosystemRepoStatusSnapshotModel.scan_run_id == scan_run_id
                )
            stmt = stmt.order_by(
                EcosystemRepoStatusSnapshotModel.snapshot_at.desc()
            ).limit(limit)
            result = await session.execute(stmt)
            rows = result.scalars().all()
            return [r.to_pydantic() for r in rows]

    # ================================================================
    # v1.5.0-A: Project ecosystem settings helpers
    # ================================================================

    async def get_ecosystem_project_settings(
        self,
        project_id: str,
    ) -> EcosystemProjectSettings | None:
        """按 project_id 获取项目的 ecosystem 配置。"""
        if not project_id:
            return None
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemProjectSettingsModel).where(
                EcosystemProjectSettingsModel.project_id == project_id
            )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            return row.to_pydantic() if row else None

    async def upsert_ecosystem_project_settings(
        self,
        settings: EcosystemProjectSettings,
    ) -> EcosystemProjectSettings:
        """按 project_id 主键 upsert 项目 ecosystem 配置。

        已存在则更新所有字段（除 created_at）；不存在则插入。
        updated_at 总是设为当前 UTC。
        """
        if not settings.project_id:
            raise ValueError("project_id 不能为空")
        now = datetime.now(tz=timezone.utc)
        async with get_session(self._db_url) as session:
            stmt = select(EcosystemProjectSettingsModel).where(
                EcosystemProjectSettingsModel.project_id == settings.project_id
            )
            result = await session.execute(stmt)
            row = result.scalar_one_or_none()
            if row is None:
                settings.updated_at = now
                session.add(EcosystemProjectSettingsModel.from_pydantic(settings))
            else:
                row.min_stars = settings.min_stars
                row.top_n = settings.top_n
                row.refresh_interval_days = settings.refresh_interval_days
                row.auto_shallow_on_archive = settings.auto_shallow_on_archive
                row.focus_topics = settings.focus_topics
                row.focus_languages = settings.focus_languages
                row.shallow_concurrency = settings.shallow_concurrency
                row.deep_concurrency = settings.deep_concurrency
                row.updated_at = now
                settings.updated_at = now
        return settings

    async def ensure_ecosystem_project_settings(
        self,
        project_id: str,
        *,
        is_ai_team_os: bool = False,
    ) -> EcosystemProjectSettings:
        """确保项目存在 ecosystem 设置；不存在则按默认值创建。

        AI Team OS 项目用更严格默认 (min_stars=5000, focus claude/mcp/agent topics)；
        其他项目用通用默认 (min_stars=1000, top_n=100, focus_topics=[])。

        幂等：已存在则直接返回，不覆盖人工修改。
        """
        existing = await self.get_ecosystem_project_settings(project_id)
        if existing is not None:
            return existing
        if is_ai_team_os:
            payload = EcosystemProjectSettings(
                project_id=project_id,
                min_stars=5000,
                top_n=200,
                focus_topics=["claude-code", "mcp", "agent-framework"],
            )
        else:
            payload = EcosystemProjectSettings(
                project_id=project_id,
                min_stars=1000,
                top_n=100,
            )
        return await self.upsert_ecosystem_project_settings(payload)
