-- 006_ops_brain_schema.sql
--
-- Ops Brain (forked AI-company) schema, ported from SQLite SQLAlchemy
-- models at AI-company/src/aiteam/storage/models.py to native Postgres
-- with multi-tenant Row-Level Security.
--
-- Tenancy: every row carries tenant_id UUID NOT NULL. RLS is enforced
-- via the standard daemon GUC `app.tenant_id`, matching the pattern in
-- apps/daemon/src/db/tenant-context.ts + db/pool.ts (withTenant()).
--
-- Dropped on purpose (dead weight): ecosystem_* tables, failure_alchemy,
-- what_if, and meeting templates (debate / council / brainstorm /
-- lean_coffee). loop_states lives in 008_ops_brain_extras.sql alongside
-- newer Track A.2 additions.
--
-- Idempotent: CREATE SCHEMA / TABLE / INDEX use IF NOT EXISTS; policies
-- are dropped-then-created since CREATE POLICY IF NOT EXISTS only landed
-- in PG15 and we target broader compatibility.

CREATE SCHEMA IF NOT EXISTS ops;

-- ---------------------------------------------------------------------
-- Helper: enable RLS + tenant_isolation policy. Repeated for each table.
-- ---------------------------------------------------------------------

-- ============================================================
-- ops.projects
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.projects (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    name            TEXT NOT NULL,
    root_path       TEXT NOT NULL DEFAULT '',
    description     TEXT NOT NULL DEFAULT '',
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,
    external_id     TEXT,
    external_source TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ops_projects_tenant ON ops.projects (tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_projects_tenant_root
    ON ops.projects (tenant_id, root_path) WHERE root_path <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_projects_tenant_external
    ON ops.projects (tenant_id, external_source, external_id)
    WHERE external_id IS NOT NULL;
ALTER TABLE ops.projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.projects;
CREATE POLICY tenant_isolation ON ops.projects
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.phases
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.phases (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    project_id   UUID NOT NULL,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'planning',
    "order"      INTEGER NOT NULL DEFAULT 0,
    config       JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ops_phases_tenant_project
    ON ops.phases (tenant_id, project_id);
ALTER TABLE ops.phases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.phases;
CREATE POLICY tenant_isolation ON ops.phases
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.teams
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.teams (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL,
    name             TEXT NOT NULL,
    mode             TEXT NOT NULL DEFAULT 'coordinate',
    project_id       UUID,
    leader_agent_id  UUID,
    status           TEXT NOT NULL DEFAULT 'active',
    summary          TEXT NOT NULL DEFAULT '',
    config           JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at     TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_teams_tenant_name
    ON ops.teams (tenant_id, name);
CREATE INDEX IF NOT EXISTS ix_ops_teams_tenant_project
    ON ops.teams (tenant_id, project_id);
ALTER TABLE ops.teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.teams;
CREATE POLICY tenant_isolation ON ops.teams
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.agents
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.agents (
    id                UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    team_id           UUID NOT NULL,
    name              TEXT NOT NULL,
    role              TEXT NOT NULL,
    system_prompt     TEXT NOT NULL DEFAULT '',
    model             TEXT NOT NULL DEFAULT 'claude-opus-4-6',
    status            TEXT NOT NULL DEFAULT 'waiting',
    config            JSONB NOT NULL DEFAULT '{}'::jsonb,
    source            TEXT NOT NULL DEFAULT 'api',
    session_id        TEXT,
    cc_tool_use_id    TEXT,
    current_task      TEXT,
    project_id        UUID,
    current_phase_id  UUID,
    trust_score       DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    external_id       TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_active_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ops_agents_tenant_team
    ON ops.agents (tenant_id, team_id);
CREATE INDEX IF NOT EXISTS ix_ops_agents_tenant_project
    ON ops.agents (tenant_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_agents_tenant_external
    ON ops.agents (tenant_id, external_id) WHERE external_id IS NOT NULL;
ALTER TABLE ops.agents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.agents;
CREATE POLICY tenant_isolation ON ops.agents
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.tasks (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    team_id         UUID,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'pending',
    assigned_to     UUID,
    result          TEXT,
    parent_id       UUID,
    project_id      UUID,
    depends_on      JSONB NOT NULL DEFAULT '[]'::jsonb,
    depth           INTEGER NOT NULL DEFAULT 0,
    "order"         INTEGER NOT NULL DEFAULT 0,
    template_id     TEXT,
    priority        TEXT NOT NULL DEFAULT 'medium',
    horizon         TEXT NOT NULL DEFAULT 'short',
    tags            JSONB NOT NULL DEFAULT '[]'::jsonb,
    config          JSONB NOT NULL DEFAULT '{}'::jsonb,
    external_id     TEXT,
    external_source TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ops_tasks_tenant_team
    ON ops.tasks (tenant_id, team_id);
CREATE INDEX IF NOT EXISTS ix_ops_tasks_tenant_status
    ON ops.tasks (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_ops_tasks_tenant_project
    ON ops.tasks (tenant_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_tasks_tenant_external
    ON ops.tasks (tenant_id, external_source, external_id)
    WHERE external_id IS NOT NULL;
ALTER TABLE ops.tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.tasks;
CREATE POLICY tenant_isolation ON ops.tasks
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.memories
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.memories (
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    scope       TEXT NOT NULL,
    scope_id    TEXT NOT NULL,
    content     TEXT NOT NULL,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    accessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ops_memories_tenant_scope
    ON ops.memories (tenant_id, scope, scope_id);
ALTER TABLE ops.memories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.memories;
CREATE POLICY tenant_isolation ON ops.memories
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.events
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.events (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    type            TEXT NOT NULL,
    source          TEXT NOT NULL,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    entity_id       TEXT,
    entity_type     TEXT,
    state_snapshot  JSONB
);
CREATE INDEX IF NOT EXISTS ix_ops_events_tenant_type
    ON ops.events (tenant_id, type);
CREATE INDEX IF NOT EXISTS ix_ops_events_tenant_source
    ON ops.events (tenant_id, source);
CREATE INDEX IF NOT EXISTS ix_ops_events_tenant_entity
    ON ops.events (tenant_id, entity_id);
CREATE INDEX IF NOT EXISTS ix_ops_events_tenant_timestamp
    ON ops.events (tenant_id, "timestamp" DESC);
ALTER TABLE ops.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.events;
CREATE POLICY tenant_isolation ON ops.events
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.meetings
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.meetings (
    id            UUID PRIMARY KEY,
    tenant_id     UUID NOT NULL,
    team_id       UUID NOT NULL,
    topic         TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'active',
    participants  JSONB NOT NULL DEFAULT '[]'::jsonb,
    project_id    UUID,
    meta_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    concluded_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ops_meetings_tenant_team
    ON ops.meetings (tenant_id, team_id);
ALTER TABLE ops.meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.meetings;
CREATE POLICY tenant_isolation ON ops.meetings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.meeting_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.meeting_messages (
    id            UUID PRIMARY KEY,
    tenant_id     UUID NOT NULL,
    meeting_id    UUID NOT NULL,
    agent_id      UUID NOT NULL,
    agent_name    TEXT NOT NULL,
    content       TEXT NOT NULL,
    round_number  INTEGER NOT NULL DEFAULT 1,
    "timestamp"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    metadata      JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_ops_meeting_messages_tenant_meeting
    ON ops.meeting_messages (tenant_id, meeting_id);
CREATE INDEX IF NOT EXISTS ix_ops_meeting_messages_tenant_agent
    ON ops.meeting_messages (tenant_id, agent_id);
ALTER TABLE ops.meeting_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.meeting_messages;
CREATE POLICY tenant_isolation ON ops.meeting_messages
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.agent_activities
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.agent_activities (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    agent_id        UUID NOT NULL,
    session_id      TEXT NOT NULL,
    tool_name       TEXT NOT NULL,
    input_summary   TEXT NOT NULL DEFAULT '',
    output_summary  TEXT NOT NULL DEFAULT '',
    "timestamp"     TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms     INTEGER,
    status          TEXT NOT NULL DEFAULT 'completed',
    error           TEXT,
    cost_usd        NUMERIC(12, 6),
    tokens_input    INTEGER,
    tokens_output   INTEGER
);
CREATE INDEX IF NOT EXISTS ix_ops_agent_activities_tenant_agent
    ON ops.agent_activities (tenant_id, agent_id);
CREATE INDEX IF NOT EXISTS ix_ops_agent_activities_tenant_session
    ON ops.agent_activities (tenant_id, session_id);
CREATE INDEX IF NOT EXISTS ix_ops_agent_activities_tenant_timestamp
    ON ops.agent_activities (tenant_id, "timestamp" DESC);
ALTER TABLE ops.agent_activities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.agent_activities;
CREATE POLICY tenant_isolation ON ops.agent_activities
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.scheduled_tasks
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.scheduled_tasks (
    id                UUID PRIMARY KEY,
    tenant_id         UUID NOT NULL,
    team_id           UUID,
    name              TEXT NOT NULL,
    description       TEXT NOT NULL DEFAULT '',
    interval_seconds  INTEGER NOT NULL,
    action_type       TEXT NOT NULL,
    action_config     JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled           BOOLEAN NOT NULL DEFAULT TRUE,
    last_run_at       TIMESTAMPTZ,
    next_run_at       TIMESTAMPTZ NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ops_scheduled_tasks_tenant_team
    ON ops.scheduled_tasks (tenant_id, team_id);
CREATE INDEX IF NOT EXISTS ix_ops_scheduled_tasks_tenant_next_run
    ON ops.scheduled_tasks (tenant_id, next_run_at) WHERE enabled = TRUE;
ALTER TABLE ops.scheduled_tasks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.scheduled_tasks;
CREATE POLICY tenant_isolation ON ops.scheduled_tasks
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.cross_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.cross_messages (
    id                  UUID PRIMARY KEY,
    tenant_id           UUID NOT NULL,
    from_project_id     TEXT NOT NULL,
    from_project_dir    TEXT NOT NULL,
    to_project_id       TEXT,
    sender_name         TEXT NOT NULL,
    content             TEXT NOT NULL,
    message_type        TEXT NOT NULL DEFAULT 'notification',
    metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ops_cross_messages_tenant_from
    ON ops.cross_messages (tenant_id, from_project_id);
CREATE INDEX IF NOT EXISTS ix_ops_cross_messages_tenant_to
    ON ops.cross_messages (tenant_id, to_project_id);
ALTER TABLE ops.cross_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.cross_messages;
CREATE POLICY tenant_isolation ON ops.cross_messages
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.wake_sessions
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.wake_sessions (
    id                    UUID PRIMARY KEY,
    tenant_id             UUID NOT NULL,
    scheduled_task_id     UUID NOT NULL,
    agent_name            TEXT NOT NULL,
    team_id               UUID,
    started_at            TIMESTAMPTZ NOT NULL,
    finished_at           TIMESTAMPTZ,
    outcome               TEXT NOT NULL DEFAULT '',
    triage_result         TEXT NOT NULL DEFAULT '',
    stdout_summary        TEXT NOT NULL DEFAULT '',
    exit_code             INTEGER,
    consecutive_failures  INTEGER NOT NULL DEFAULT 0,
    duration_seconds      DOUBLE PRECISION NOT NULL DEFAULT 0.0
);
CREATE INDEX IF NOT EXISTS ix_ops_wake_sessions_tenant_task
    ON ops.wake_sessions (tenant_id, scheduled_task_id);
CREATE INDEX IF NOT EXISTS ix_ops_wake_sessions_tenant_agent
    ON ops.wake_sessions (tenant_id, agent_name);
CREATE INDEX IF NOT EXISTS ix_ops_wake_sessions_tenant_started
    ON ops.wake_sessions (tenant_id, started_at DESC);
ALTER TABLE ops.wake_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.wake_sessions;
CREATE POLICY tenant_isolation ON ops.wake_sessions
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.leader_briefings
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.leader_briefings (
    id              UUID PRIMARY KEY,
    tenant_id       UUID NOT NULL,
    title           TEXT NOT NULL,
    description     TEXT NOT NULL DEFAULT '',
    options         TEXT NOT NULL DEFAULT '',
    recommendation  TEXT NOT NULL DEFAULT '',
    urgency         TEXT NOT NULL DEFAULT 'medium',
    status          TEXT NOT NULL DEFAULT 'pending',
    resolution      TEXT NOT NULL DEFAULT '',
    project_id      UUID,
    created_at      TIMESTAMPTZ NOT NULL,
    resolved_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS ix_ops_leader_briefings_tenant_status
    ON ops.leader_briefings (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_ops_leader_briefings_tenant_project
    ON ops.leader_briefings (tenant_id, project_id);
ALTER TABLE ops.leader_briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.leader_briefings;
CREATE POLICY tenant_isolation ON ops.leader_briefings
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.channel_messages
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.channel_messages (
    id          UUID PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    channel     TEXT NOT NULL,
    sender      TEXT NOT NULL,
    content     TEXT NOT NULL,
    mentions    JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ops_channel_messages_tenant_channel
    ON ops.channel_messages (tenant_id, channel, created_at DESC);
ALTER TABLE ops.channel_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.channel_messages;
CREATE POLICY tenant_isolation ON ops.channel_messages
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.reports
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.reports (
    id           UUID PRIMARY KEY,
    tenant_id    UUID NOT NULL,
    project_id   UUID,
    author       TEXT NOT NULL DEFAULT '',
    topic        TEXT NOT NULL DEFAULT '',
    report_type  TEXT NOT NULL DEFAULT 'research',
    date_str     TEXT NOT NULL DEFAULT '',
    content      TEXT NOT NULL DEFAULT '',
    task_id      UUID,
    team_id      UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_ops_reports_tenant_project
    ON ops.reports (tenant_id, project_id);
CREATE INDEX IF NOT EXISTS ix_ops_reports_tenant_created
    ON ops.reports (tenant_id, created_at DESC);
ALTER TABLE ops.reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.reports;
CREATE POLICY tenant_isolation ON ops.reports
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- ============================================================
-- ops.pipeline_stage_history (append-only)
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.pipeline_stage_history (
    id               UUID PRIMARY KEY,
    tenant_id        UUID NOT NULL,
    task_id          UUID NOT NULL,
    from_stage       TEXT,
    to_stage         TEXT NOT NULL,
    transitioned_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    triggered_by     TEXT NOT NULL DEFAULT 'manual',
    reason           TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS ix_ops_pipeline_history_tenant_task
    ON ops.pipeline_stage_history (tenant_id, task_id, transitioned_at DESC);
ALTER TABLE ops.pipeline_stage_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.pipeline_stage_history;
CREATE POLICY tenant_isolation ON ops.pipeline_stage_history
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
