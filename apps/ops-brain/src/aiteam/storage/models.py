"""AI Team OS — SQLAlchemy ORM models, BLAIQ-unified.

All tables live in the Postgres `ops` schema. Every row carries a
`tenant_id UUID NOT NULL`; row-level security policies on the BLAIQ
Postgres enforce isolation via the `app.tenant_id` GUC, which is set
per-request by `aiteam.middleware.tenant.TenantMiddleware` and
propagated to the SQLAlchemy session via `aiteam.storage.connection`.

Ecosystem / failure-alchemy / what-if / meeting-template models were
dropped in the BLAIQ unification (Track G); the corresponding Pydantic
imports are kept comment-guarded so legacy imports raise a clear error.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from aiteam.types import (
    Agent,
    AgentActivity,
    AgentStatus,
    ChannelMessage,
    CrossMessage,
    CrossMessageType,
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
    Project,
    Report,
    ScheduledTask,
    StageTransition,
    Task,
    TaskHorizon,
    TaskPriority,
    TaskStatus,
    Team,
    WakeSession,
)

# ============================================================
# Base + tenant mixin
# ============================================================

OPS_SCHEMA = "ops"


def _utcnow() -> datetime:
    return datetime.now(tz=timezone.utc)


class Base(DeclarativeBase):
    """SQLAlchemy declarative base class for the `ops` schema."""


# ============================================================
# ORM Models — all live in schema `ops`
# ============================================================


class ProjectModel(Base):
    """ops.projects — project registry."""

    __tablename__ = "projects"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    root_path: Mapped[str] = mapped_column(Text, nullable=False, default="")
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    external_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_pydantic(self) -> Project:
        return Project(
            id=self.id,
            name=self.name,
            root_path=self.root_path or "",
            description=self.description or "",
            config=self.config or {},
            created_at=self.created_at,
            updated_at=self.updated_at,
        )

    @staticmethod
    def from_pydantic(project: Project, tenant_id: str) -> ProjectModel:
        return ProjectModel(
            id=project.id,
            tenant_id=tenant_id,
            name=project.name,
            root_path=project.root_path,
            description=project.description,
            config=project.config,
            created_at=project.created_at,
            updated_at=project.updated_at,
        )


class PhaseModel(Base):
    """ops.phases — project phases."""

    __tablename__ = "phases"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    project_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="planning")
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_pydantic(self) -> Phase:
        return Phase(
            id=self.id,
            project_id=self.project_id,
            name=self.name,
            description=self.description or "",
            status=PhaseStatus(self.status),
            order=self.order or 0,
            config=self.config or {},
            created_at=self.created_at,
            updated_at=self.updated_at,
        )

    @staticmethod
    def from_pydantic(phase: Phase, tenant_id: str) -> PhaseModel:
        return PhaseModel(
            id=phase.id,
            tenant_id=tenant_id,
            project_id=phase.project_id,
            name=phase.name,
            description=phase.description,
            status=phase.status.value,
            order=phase.order,
            config=phase.config,
            created_at=phase.created_at,
            updated_at=phase.updated_at,
        )


class TeamModel(Base):
    """ops.teams — agent teams."""

    __tablename__ = "teams"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name", name="uq_ops_teams_tenant_name"),
        {"schema": OPS_SCHEMA},
    )

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    mode: Mapped[str] = mapped_column(String(20), nullable=False, default="coordinate")
    project_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    leader_agent_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_pydantic(self) -> Team:
        from aiteam.types import TeamStatus

        return Team(
            id=self.id,
            name=self.name,
            mode=OrchestrationMode(self.mode),
            project_id=self.project_id,
            leader_agent_id=self.leader_agent_id,
            status=TeamStatus(self.status) if self.status else TeamStatus.ACTIVE,
            summary=self.summary or "",
            config=self.config or {},
            created_at=self.created_at,
            updated_at=self.updated_at,
            completed_at=self.completed_at,
        )

    @staticmethod
    def from_pydantic(team: Team, tenant_id: str) -> TeamModel:
        return TeamModel(
            id=team.id,
            tenant_id=tenant_id,
            name=team.name,
            mode=team.mode.value,
            project_id=team.project_id,
            leader_agent_id=team.leader_agent_id,
            status=team.status.value if hasattr(team.status, "value") else str(team.status),
            summary=team.summary,
            config=team.config,
            created_at=team.created_at,
            updated_at=team.updated_at,
            completed_at=team.completed_at,
        )


class AgentModel(Base):
    """ops.agents — Claude agents per team."""

    __tablename__ = "agents"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(Text, nullable=False)
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False, default="")
    model: Mapped[str] = mapped_column(String(100), nullable=False, default="claude-opus-4-6")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="waiting")
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    source: Mapped[str] = mapped_column(String(20), nullable=False, default="api")
    session_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    cc_tool_use_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    current_task: Mapped[str | None] = mapped_column(Text, nullable=True)
    project_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    current_phase_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    trust_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    external_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    last_active_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_pydantic(self) -> Agent:
        return Agent(
            id=self.id,
            team_id=self.team_id,
            name=self.name,
            role=self.role,
            system_prompt=self.system_prompt or "",
            model=self.model or "claude-opus-4-6",
            status=AgentStatus(self.status),
            config=self.config or {},
            source=self.source or "api",
            session_id=self.session_id,
            cc_tool_use_id=self.cc_tool_use_id,
            current_task=self.current_task,
            project_id=self.project_id,
            current_phase_id=self.current_phase_id,
            trust_score=self.trust_score if self.trust_score is not None else 0.5,
            created_at=self.created_at,
            last_active_at=self.last_active_at,
        )

    @staticmethod
    def from_pydantic(agent: Agent, tenant_id: str) -> AgentModel:
        return AgentModel(
            id=agent.id,
            tenant_id=tenant_id,
            team_id=agent.team_id,
            name=agent.name,
            role=agent.role,
            system_prompt=agent.system_prompt,
            model=agent.model,
            status=agent.status.value,
            config=agent.config,
            source=agent.source,
            session_id=agent.session_id,
            cc_tool_use_id=agent.cc_tool_use_id,
            current_task=agent.current_task,
            project_id=agent.project_id,
            current_phase_id=agent.current_phase_id,
            trust_score=agent.trust_score,
            created_at=agent.created_at,
            last_active_at=agent.last_active_at,
        )


class TaskModel(Base):
    """ops.tasks — work items."""

    __tablename__ = "tasks"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    team_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending", index=True)
    assigned_to: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    result: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    project_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    depends_on: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    template_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    horizon: Mapped[str] = mapped_column(String(20), nullable=False, default="short")
    tags: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    external_id: Mapped[str | None] = mapped_column(Text, nullable=True)
    external_source: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_pydantic(self) -> Task:
        return Task(
            id=self.id,
            team_id=self.team_id,
            title=self.title,
            description=self.description or "",
            status=TaskStatus(self.status),
            assigned_to=self.assigned_to,
            result=self.result,
            parent_id=self.parent_id,
            project_id=self.project_id,
            depends_on=self.depends_on if isinstance(self.depends_on, list) else [],
            depth=self.depth or 0,
            order=self.order or 0,
            template_id=self.template_id,
            priority=TaskPriority(self.priority) if self.priority else TaskPriority.MEDIUM,
            horizon=TaskHorizon(self.horizon) if self.horizon else TaskHorizon.SHORT,
            tags=self.tags if isinstance(self.tags, list) else [],
            config=self.config if isinstance(self.config, dict) else {},
            created_at=self.created_at,
            started_at=self.started_at,
            completed_at=self.completed_at,
        )

    @staticmethod
    def from_pydantic(task: Task, tenant_id: str) -> TaskModel:
        return TaskModel(
            id=task.id,
            tenant_id=tenant_id,
            team_id=task.team_id,
            title=task.title,
            description=task.description,
            status=task.status.value,
            assigned_to=task.assigned_to,
            result=task.result,
            parent_id=task.parent_id,
            project_id=task.project_id,
            depends_on=task.depends_on,
            depth=task.depth,
            order=task.order,
            template_id=task.template_id,
            priority=task.priority.value,
            horizon=task.horizon.value,
            tags=task.tags,
            config=task.config,
            created_at=task.created_at,
            started_at=task.started_at,
            completed_at=task.completed_at,
        )


class MemoryModel(Base):
    """ops.memories — agent memories."""

    __tablename__ = "memories"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    scope: Mapped[str] = mapped_column(String(20), nullable=False, index=True)
    scope_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    accessed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_pydantic(self) -> Memory:
        return Memory(
            id=self.id,
            scope=MemoryScope(self.scope),
            scope_id=self.scope_id,
            content=self.content,
            metadata=self.metadata_json or {},
            created_at=self.created_at,
            accessed_at=self.accessed_at,
        )

    @staticmethod
    def from_pydantic(memory: Memory, tenant_id: str) -> MemoryModel:
        return MemoryModel(
            id=memory.id,
            tenant_id=tenant_id,
            scope=memory.scope.value,
            scope_id=memory.scope_id,
            content=memory.content,
            metadata_json=memory.metadata,
            created_at=memory.created_at,
            accessed_at=memory.accessed_at,
        )


class EventModel(Base):
    """ops.events — system event log."""

    __tablename__ = "events"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    state_snapshot: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    def to_pydantic(self) -> Event:
        return Event(
            id=self.id,
            type=EventType(self.type),
            source=self.source,
            data=self.data or {},
            timestamp=self.timestamp,
            entity_id=self.entity_id,
            entity_type=self.entity_type,
            state_snapshot=self.state_snapshot,
        )

    @staticmethod
    def from_pydantic(event: Event, tenant_id: str) -> EventModel:
        return EventModel(
            id=event.id,
            tenant_id=tenant_id,
            type=event.type.value,
            source=event.source,
            data=event.data,
            timestamp=event.timestamp,
            entity_id=event.entity_id,
            entity_type=event.entity_type,
            state_snapshot=event.state_snapshot,
        )


class MeetingModel(Base):
    """ops.meetings — team meetings (debate/council/brainstorm/lean_coffee templates dropped)."""

    __tablename__ = "meetings"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    topic: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    participants: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    project_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    meta_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    concluded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_pydantic(self) -> Meeting:
        return Meeting(
            id=self.id,
            team_id=self.team_id,
            topic=self.topic,
            status=MeetingStatus(self.status),
            participants=self.participants or [],
            project_id=self.project_id,
            meta_json=self.meta_json or {},
            created_at=self.created_at,
            concluded_at=self.concluded_at,
        )

    @staticmethod
    def from_pydantic(meeting: Meeting, tenant_id: str) -> MeetingModel:
        return MeetingModel(
            id=meeting.id,
            tenant_id=tenant_id,
            team_id=meeting.team_id,
            topic=meeting.topic,
            status=meeting.status.value,
            participants=meeting.participants,
            project_id=meeting.project_id,
            meta_json=meeting.meta_json,
            created_at=meeting.created_at,
            concluded_at=meeting.concluded_at,
        )


class MeetingMessageModel(Base):
    """ops.meeting_messages — utterances in a meeting."""

    __tablename__ = "meeting_messages"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    meeting_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    agent_name: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    round_number: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    metadata_json: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)

    def to_pydantic(self) -> MeetingMessage:
        return MeetingMessage(
            id=self.id,
            meeting_id=self.meeting_id,
            agent_id=self.agent_id,
            agent_name=self.agent_name,
            content=self.content,
            round_number=self.round_number,
            timestamp=self.timestamp,
            msg_metadata=self.metadata_json or {},
        )

    @staticmethod
    def from_pydantic(msg: MeetingMessage, tenant_id: str) -> MeetingMessageModel:
        return MeetingMessageModel(
            id=msg.id,
            tenant_id=tenant_id,
            meeting_id=msg.meeting_id,
            agent_id=msg.agent_id,
            agent_name=msg.agent_name,
            content=msg.content,
            round_number=msg.round_number,
            timestamp=msg.timestamp,
            metadata_json=msg.msg_metadata or {},
        )


class AgentActivityModel(Base):
    """ops.agent_activities — tool-call audit log with cost + tokens."""

    __tablename__ = "agent_activities"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    agent_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    session_id: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    input_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    output_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="completed")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Numeric(12, 6), nullable=True)
    tokens_input: Mapped[int | None] = mapped_column(Integer, nullable=True)
    tokens_output: Mapped[int | None] = mapped_column(Integer, nullable=True)

    def to_pydantic(self) -> AgentActivity:
        return AgentActivity(
            id=self.id,
            agent_id=self.agent_id,
            session_id=self.session_id,
            tool_name=self.tool_name,
            input_summary=self.input_summary or "",
            output_summary=self.output_summary or "",
            timestamp=self.timestamp,
            duration_ms=self.duration_ms,
            status=self.status or "completed",
            error=self.error,
        )

    @staticmethod
    def from_pydantic(activity: AgentActivity, tenant_id: str) -> AgentActivityModel:
        return AgentActivityModel(
            id=activity.id,
            tenant_id=tenant_id,
            agent_id=activity.agent_id,
            session_id=activity.session_id,
            tool_name=activity.tool_name,
            input_summary=activity.input_summary,
            output_summary=activity.output_summary,
            timestamp=activity.timestamp,
            duration_ms=activity.duration_ms,
            status=activity.status,
            error=activity.error,
        )


class ScheduledTaskModel(Base):
    """ops.scheduled_tasks — recurring agent jobs."""

    __tablename__ = "scheduled_tasks"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    team_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True, index=True)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    interval_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    action_config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_pydantic(self) -> ScheduledTask:
        return ScheduledTask(
            id=self.id,
            team_id=self.team_id,
            name=self.name,
            description=self.description or "",
            interval_seconds=self.interval_seconds,
            action_type=self.action_type,
            action_config=self.action_config or {},
            enabled=self.enabled,
            last_run_at=self.last_run_at,
            next_run_at=self.next_run_at,
            created_at=self.created_at,
        )

    @staticmethod
    def from_pydantic(task: ScheduledTask, tenant_id: str) -> ScheduledTaskModel:
        return ScheduledTaskModel(
            id=task.id,
            tenant_id=tenant_id,
            team_id=task.team_id,
            name=task.name,
            description=task.description,
            interval_seconds=task.interval_seconds,
            action_type=task.action_type,
            action_config=task.action_config,
            enabled=task.enabled,
            last_run_at=task.last_run_at,
            next_run_at=task.next_run_at,
            created_at=task.created_at,
        )


class CrossMessageModel(Base):
    """ops.cross_messages — cross-project messages."""

    __tablename__ = "cross_messages"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    from_project_id: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    from_project_dir: Mapped[str] = mapped_column(Text, nullable=False)
    to_project_id: Mapped[str | None] = mapped_column(Text, nullable=True, index=True)
    sender_name: Mapped[str] = mapped_column(Text, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    message_type: Mapped[str] = mapped_column(String(20), nullable=False, default="notification")
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_pydantic(self) -> CrossMessage:
        return CrossMessage(
            id=self.id,
            from_project_id=self.from_project_id,
            from_project_dir=self.from_project_dir,
            to_project_id=self.to_project_id,
            sender_name=self.sender_name,
            content=self.content,
            message_type=CrossMessageType(self.message_type),
            metadata=self.metadata_json or {},
            created_at=self.created_at,
            read_at=self.read_at,
        )

    @staticmethod
    def from_pydantic(msg: CrossMessage, tenant_id: str) -> CrossMessageModel:
        return CrossMessageModel(
            id=msg.id,
            tenant_id=tenant_id,
            from_project_id=msg.from_project_id,
            from_project_dir=msg.from_project_dir,
            to_project_id=msg.to_project_id,
            sender_name=msg.sender_name,
            content=msg.content,
            message_type=msg.message_type.value,
            metadata_json=msg.metadata,
            created_at=msg.created_at,
            read_at=msg.read_at,
        )


class WakeSessionModel(Base):
    """ops.wake_sessions — wake_agent subprocess executions."""

    __tablename__ = "wake_sessions"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    scheduled_task_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    agent_name: Mapped[str] = mapped_column(Text, nullable=False, index=True)
    team_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    outcome: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    triage_result: Mapped[str] = mapped_column(Text, nullable=False, default="")
    stdout_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    exit_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    consecutive_failures: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)

    def to_pydantic(self) -> WakeSession:
        return WakeSession(
            id=self.id,
            scheduled_task_id=self.scheduled_task_id,
            agent_name=self.agent_name,
            team_id=self.team_id or "",
            started_at=self.started_at,
            finished_at=self.finished_at,
            outcome=self.outcome or "",
            triage_result=self.triage_result or "",
            stdout_summary=self.stdout_summary or "",
            exit_code=self.exit_code,
            consecutive_failures=self.consecutive_failures,
            duration_seconds=self.duration_seconds,
        )

    @staticmethod
    def from_pydantic(ws: WakeSession, tenant_id: str) -> WakeSessionModel:
        return WakeSessionModel(
            id=ws.id,
            tenant_id=tenant_id,
            scheduled_task_id=ws.scheduled_task_id,
            agent_name=ws.agent_name,
            team_id=ws.team_id or None,
            started_at=ws.started_at,
            finished_at=ws.finished_at,
            outcome=ws.outcome,
            triage_result=ws.triage_result,
            stdout_summary=ws.stdout_summary,
            exit_code=ws.exit_code,
            consecutive_failures=ws.consecutive_failures,
            duration_seconds=ws.duration_seconds,
        )


class LeaderBriefingModel(Base):
    """ops.leader_briefings — pending decisions for user review."""

    __tablename__ = "leader_briefings"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    options: Mapped[str] = mapped_column(Text, nullable=False, default="")
    recommendation: Mapped[str] = mapped_column(Text, nullable=False, default="")
    urgency: Mapped[str] = mapped_column(String(20), nullable=False, default="medium")
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    resolution: Mapped[str] = mapped_column(Text, nullable=False, default="")
    project_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    def to_pydantic(self) -> LeaderBriefing:
        return LeaderBriefing(
            id=self.id,
            title=self.title,
            description=self.description or "",
            options=self.options or "",
            recommendation=self.recommendation or "",
            urgency=self.urgency or "medium",
            status=self.status or "pending",
            resolution=self.resolution or "",
            project_id=self.project_id or "",
            created_at=self.created_at,
            resolved_at=self.resolved_at,
        )

    @staticmethod
    def from_pydantic(briefing: LeaderBriefing, tenant_id: str) -> LeaderBriefingModel:
        return LeaderBriefingModel(
            id=briefing.id,
            tenant_id=tenant_id,
            title=briefing.title,
            description=briefing.description,
            options=briefing.options,
            recommendation=briefing.recommendation,
            urgency=briefing.urgency,
            status=briefing.status,
            resolution=briefing.resolution,
            project_id=briefing.project_id or None,
            created_at=briefing.created_at,
            resolved_at=briefing.resolved_at,
        )


class ChannelMessageModel(Base):
    """ops.channel_messages — cross-team @mention channel."""

    __tablename__ = "channel_messages"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    channel: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    sender: Mapped[str] = mapped_column(String(100), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    mentions: Mapped[list[str]] = mapped_column(JSONB, nullable=False, default=list)
    metadata_json: Mapped[dict[str, Any]] = mapped_column("metadata", JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_pydantic(self) -> ChannelMessage:
        return ChannelMessage(
            id=self.id,
            channel=self.channel,
            sender=self.sender,
            content=self.content,
            mentions=self.mentions if isinstance(self.mentions, list) else [],
            metadata=self.metadata_json or {},
            created_at=self.created_at,
        )

    @staticmethod
    def from_pydantic(msg: ChannelMessage, tenant_id: str) -> ChannelMessageModel:
        return ChannelMessageModel(
            id=msg.id,
            tenant_id=tenant_id,
            channel=msg.channel,
            sender=msg.sender,
            content=msg.content,
            mentions=msg.mentions,
            metadata_json=msg.metadata,
            created_at=msg.created_at,
        )


class ReportModel(Base):
    """ops.reports — research/analysis reports."""

    __tablename__ = "reports"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    project_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True, index=True)
    author: Mapped[str] = mapped_column(Text, nullable=False, default="")
    topic: Mapped[str] = mapped_column(Text, nullable=False, default="")
    report_type: Mapped[str] = mapped_column(String(50), nullable=False, default="research")
    date_str: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    task_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    team_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)

    def to_pydantic(self) -> Report:
        return Report(
            id=self.id,
            project_id=self.project_id or "",
            author=self.author or "",
            topic=self.topic or "",
            report_type=self.report_type or "research",
            date=self.date_str or "",
            content=self.content or "",
            task_id=self.task_id or "",
            team_id=self.team_id or "",
            created_at=self.created_at,
        )

    @staticmethod
    def from_pydantic(report: Report, tenant_id: str) -> ReportModel:
        return ReportModel(
            id=report.id,
            tenant_id=tenant_id,
            project_id=report.project_id or None,
            author=report.author,
            topic=report.topic,
            report_type=report.report_type,
            date_str=report.date,
            content=report.content,
            task_id=report.task_id or None,
            team_id=report.team_id or None,
            created_at=report.created_at,
        )


class PipelineStageHistoryModel(Base):
    """ops.pipeline_stage_history — append-only stage transition log."""

    __tablename__ = "pipeline_stage_history"
    __table_args__ = {"schema": OPS_SCHEMA}

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True)
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    task_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), index=True, nullable=False)
    from_stage: Mapped[str | None] = mapped_column(Text, nullable=True)
    to_stage: Mapped[str] = mapped_column(Text, nullable=False)
    transitioned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, nullable=False
    )
    triggered_by: Mapped[str] = mapped_column(Text, nullable=False, default="manual")
    reason: Mapped[str] = mapped_column(Text, nullable=False, default="")

    def to_pydantic(self) -> StageTransition:
        return StageTransition(
            id=self.id,
            task_id=self.task_id,
            from_stage=self.from_stage,
            to_stage=self.to_stage,
            transitioned_at=self.transitioned_at,
            triggered_by=self.triggered_by,  # type: ignore[arg-type]
            reason=self.reason or "",
        )

    @classmethod
    def from_pydantic(cls, p: StageTransition, tenant_id: str) -> PipelineStageHistoryModel:
        return cls(
            id=p.id,
            tenant_id=tenant_id,
            task_id=p.task_id,
            from_stage=p.from_stage,
            to_stage=p.to_stage,
            transitioned_at=p.transitioned_at,
            triggered_by=p.triggered_by,
            reason=p.reason,
        )


class LoopStateModel(Base):
    """ops.loop_states — LoopEngine per-team cursor (migration 008)."""

    __tablename__ = "loop_states"
    __table_args__ = (
        UniqueConstraint("tenant_id", "team_id", name="uq_ops_loop_states_tenant_team"),
        {"schema": OPS_SCHEMA},
    )

    id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), primary_key=True, default=lambda: str(uuid.uuid4()))
    tenant_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(PG_UUID(as_uuid=False), nullable=False, index=True)
    project_id: Mapped[str | None] = mapped_column(PG_UUID(as_uuid=False), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="idle")
    cursor: Mapped[str] = mapped_column(Text, nullable=False, default="")
    last_tick_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_tick_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    tick_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    config: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow, nullable=False)


# ============================================================
# Legacy ecosystem model stubs (Track G will delete consumers).
#
# The ecosystem_* / failure_alchemy / what_if / meeting-template tables
# were dropped in the BLAIQ unification. To keep `from aiteam.storage.models
# import EcosystemX` importable while Track G removes the call sites, we
# expose sentinel classes that raise on instantiation. Any code that
# actually constructs one of these fails fast with a clear message.
# ============================================================


class _DroppedModel:
    """Sentinel for ecosystem/failure-alchemy/what-if models removed in BLAIQ unification."""

    __abstract_dropped__ = True

    def __init__(self, *args: object, **kwargs: object) -> None:
        raise RuntimeError(
            f"{type(self).__name__} was removed in the BLAIQ unification (Track G). "
            "Update the call site to use the BLAIQ admin surface instead."
        )

    @staticmethod
    def from_pydantic(*args: object, **kwargs: object) -> "_DroppedModel":
        raise RuntimeError("ecosystem models were removed in the BLAIQ unification (Track G)")


class EcosystemRepoProfileModel(_DroppedModel):
    pass


class EcosystemDeepReviewModel(_DroppedModel):
    pass


class EcosystemTagModel(_DroppedModel):
    pass


class EcosystemRepoTagModel(_DroppedModel):
    pass


class EcosystemRelationModel(_DroppedModel):
    pass


class EcosystemScanRunModel(_DroppedModel):
    pass


class EcosystemRepoStatusSnapshotModel(_DroppedModel):
    pass


class EcosystemProjectSettingsModel(_DroppedModel):
    pass


# Helpful (non-unique) cross-tenant composite indexes for hot list paths.
Index("ix_ops_tasks_tenant_status", TaskModel.tenant_id, TaskModel.status)
Index("ix_ops_agents_tenant_team", AgentModel.tenant_id, AgentModel.team_id)
Index("ix_ops_events_tenant_ts", EventModel.tenant_id, EventModel.timestamp)
