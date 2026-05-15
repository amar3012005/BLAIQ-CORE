-- Multi-tenant Postgres schema for Open Design daemon.
-- Translates the SQLite schema in apps/daemon/src/db.ts, media-tasks.ts,
-- and critique/persistence.ts into Postgres with explicit tenant scoping.
--
-- Conventions:
--   - All "root" entity tables (projects, routines, templates) carry
--     tenant_id NOT NULL with FK to tenants(id) ON DELETE CASCADE.
--   - Child tables (messages, tabs, deployments, etc.) inherit isolation
--     via their parent's tenant scope; we still copy tenant_id where the
--     hot path queries need it without a join, to keep indexes tight.
--   - Timestamps remain milliseconds since epoch (BIGINT) to stay
--     compatible with existing JS Date.now() callsites.
--   - JSON blobs stored as TEXT to match current code paths verbatim,
--     so the DB-layer migration can be mechanical. Future migration can
--     convert to JSONB.
--   - Row-level security (RLS) is enabled as defense in depth. The
--     daemon sets `app.tenant_id` per request via `SET LOCAL`; policies
--     enforce that the session-bound tenant matches each row.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- Tenants and users
-- ============================================================================

CREATE TABLE IF NOT EXISTS tenants (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT UNIQUE NOT NULL,
  plan            TEXT NOT NULL DEFAULT 'free',
  quota_tokens_per_day  BIGINT NOT NULL DEFAULT 1000000,
  quota_runs_concurrent INTEGER NOT NULL DEFAULT 2,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

-- Mirror of Supabase auth.users. We store only the subset we need to join.
CREATE TABLE IF NOT EXISTS users (
  id                UUID PRIMARY KEY,                 -- Supabase user_id
  email             TEXT UNIQUE NOT NULL,
  primary_tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE RESTRICT,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_members (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)   ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member',
  created_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_members_user
  ON tenant_members(user_id);

-- Per-tenant rolling token usage. Reset by app code or a cron.
CREATE TABLE IF NOT EXISTS tenant_usage (
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day           DATE NOT NULL,
  tokens_used   BIGINT NOT NULL DEFAULT 0,
  requests      BIGINT NOT NULL DEFAULT 0,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, day)
);

-- ============================================================================
-- Projects (tenant root)
-- ============================================================================

CREATE TABLE IF NOT EXISTS projects (
  id                  TEXT PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  skill_id            TEXT,
  design_system_id    TEXT,
  pending_prompt      TEXT,
  metadata_json       TEXT,
  custom_instructions TEXT,
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_tenant
  ON projects(tenant_id, updated_at DESC);

-- ============================================================================
-- Templates
-- ============================================================================

CREATE TABLE IF NOT EXISTS templates (
  id                  TEXT PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  description         TEXT,
  source_project_id   TEXT,
  files_json          TEXT NOT NULL,
  created_at          BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_templates_tenant
  ON templates(tenant_id, created_at DESC);

-- ============================================================================
-- Conversations + messages
-- ============================================================================

CREATE TABLE IF NOT EXISTS conversations (
  id          TEXT PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  BIGINT NOT NULL,
  updated_at  BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_conv_project
  ON conversations(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_conv_tenant
  ON conversations(tenant_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id                       TEXT PRIMARY KEY,
  tenant_id                UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id          TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role                     TEXT NOT NULL,
  content                  TEXT NOT NULL,
  agent_id                 TEXT,
  agent_name               TEXT,
  run_id                   TEXT,
  run_status               TEXT,
  last_run_event_id        TEXT,
  events_json              TEXT,
  attachments_json         TEXT,
  comment_attachments_json TEXT,
  produced_files_json      TEXT,
  feedback_json            TEXT,
  started_at               BIGINT,
  ended_at                 BIGINT,
  position                 INTEGER NOT NULL,
  created_at               BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_conv
  ON messages(conversation_id, position);
CREATE INDEX IF NOT EXISTS idx_messages_tenant
  ON messages(tenant_id, created_at DESC);

-- ============================================================================
-- Preview comments
-- ============================================================================

CREATE TABLE IF NOT EXISTS preview_comments (
  id                  TEXT PRIMARY KEY,
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id     TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  file_path           TEXT NOT NULL,
  element_id          TEXT NOT NULL,
  selector            TEXT NOT NULL,
  label               TEXT NOT NULL,
  text                TEXT NOT NULL,
  position_json       TEXT NOT NULL,
  html_hint           TEXT NOT NULL,
  selection_kind      TEXT,
  member_count        INTEGER,
  pod_members_json    TEXT,
  note                TEXT NOT NULL,
  status              TEXT NOT NULL,
  created_at          BIGINT NOT NULL,
  updated_at          BIGINT NOT NULL,
  UNIQUE(project_id, conversation_id, file_path, element_id)
);

CREATE INDEX IF NOT EXISTS idx_preview_comments_conversation
  ON preview_comments(project_id, conversation_id, updated_at DESC);

-- ============================================================================
-- Tabs
-- ============================================================================

CREATE TABLE IF NOT EXISTS tabs (
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  position    INTEGER NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, name)
);

CREATE INDEX IF NOT EXISTS idx_tabs_project
  ON tabs(project_id, position);

-- ============================================================================
-- Deployments
-- ============================================================================

CREATE TABLE IF NOT EXISTS deployments (
  id                      TEXT PRIMARY KEY,
  tenant_id               UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id              TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_name               TEXT NOT NULL,
  provider_id             TEXT NOT NULL,
  url                     TEXT NOT NULL,
  deployment_id           TEXT,
  deployment_count        INTEGER NOT NULL DEFAULT 1,
  target                  TEXT NOT NULL DEFAULT 'preview',
  status                  TEXT NOT NULL DEFAULT 'ready',
  status_message          TEXT,
  reachable_at            BIGINT,
  provider_metadata_json  TEXT,
  created_at              BIGINT NOT NULL,
  updated_at              BIGINT NOT NULL,
  UNIQUE(project_id, file_name, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_deployments_project
  ON deployments(project_id, updated_at DESC);

-- ============================================================================
-- Routines + routine runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS routines (
  id              TEXT PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  prompt          TEXT NOT NULL,
  schedule_kind   TEXT NOT NULL,
  schedule_value  TEXT NOT NULL,
  schedule_json   TEXT,
  project_mode    TEXT NOT NULL,
  project_id      TEXT REFERENCES projects(id) ON DELETE SET NULL,
  skill_id        TEXT,
  agent_id        TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_routines_tenant
  ON routines(tenant_id, created_at ASC);

CREATE TABLE IF NOT EXISTS routine_runs (
  id              TEXT PRIMARY KEY,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  routine_id      TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  trigger         TEXT NOT NULL,
  status          TEXT NOT NULL,
  project_id      TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  agent_run_id    TEXT NOT NULL,
  started_at      BIGINT NOT NULL,
  completed_at    BIGINT,
  summary         TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_routine_runs_routine
  ON routine_runs(routine_id, started_at DESC);

-- ============================================================================
-- Media tasks
-- ============================================================================

CREATE TABLE IF NOT EXISTS media_tasks (
  id             TEXT PRIMARY KEY,
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id     TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status         TEXT NOT NULL CHECK (status IN
                   ('queued','running','done','failed','interrupted')),
  surface        TEXT,
  model          TEXT,
  progress_json  TEXT NOT NULL DEFAULT '[]',
  file_json      TEXT,
  error_json     TEXT,
  started_at     BIGINT NOT NULL,
  ended_at       BIGINT,
  created_at     BIGINT NOT NULL,
  updated_at     BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_tasks_project
  ON media_tasks(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_tasks_status
  ON media_tasks(status, updated_at DESC);

-- ============================================================================
-- Critique runs
-- ============================================================================

CREATE TABLE IF NOT EXISTS critique_runs (
  id                TEXT PRIMARY KEY,
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  conversation_id   TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  artifact_path     TEXT,
  status            TEXT NOT NULL CHECK (status IN
                      ('shipped','below_threshold','timed_out','interrupted',
                       'degraded','failed','legacy','running')),
  score             DOUBLE PRECISION,
  rounds_json       TEXT NOT NULL DEFAULT '[]',
  transcript_path   TEXT,
  protocol_version  INTEGER NOT NULL,
  created_at        BIGINT NOT NULL,
  updated_at        BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_critique_runs_project
  ON critique_runs(project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_critique_runs_status
  ON critique_runs(status);

-- ============================================================================
-- Row Level Security policies (defense in depth)
-- ============================================================================
--
-- The daemon issues `SET LOCAL app.tenant_id = '<uuid>'` at the start of each
-- authenticated request via a withTenant helper. RLS policies require the
-- session variable to match the row's tenant_id. If the daemon forgets to set
-- the variable, queries return zero rows instead of leaking cross-tenant data.

ALTER TABLE projects          ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates         ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages          ENABLE ROW LEVEL SECURITY;
ALTER TABLE preview_comments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tabs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE routines          ENABLE ROW LEVEL SECURITY;
ALTER TABLE routine_runs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_tasks       ENABLE ROW LEVEL SECURITY;
ALTER TABLE critique_runs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_usage      ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS UUID
LANGUAGE plpgsql STABLE AS $$
DECLARE
  raw TEXT;
BEGIN
  raw := current_setting('app.tenant_id', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

DO $$
DECLARE
  t TEXT;
  tenant_tables TEXT[] := ARRAY[
    'projects','templates','conversations','messages','preview_comments',
    'tabs','deployments','routines','routine_runs','media_tasks',
    'critique_runs','tenant_usage'
  ];
BEGIN
  FOREACH t IN ARRAY tenant_tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I;'
      ' CREATE POLICY tenant_isolation ON %I'
      '   USING (tenant_id = app_current_tenant())'
      '   WITH CHECK (tenant_id = app_current_tenant());',
      t, t
    );
  END LOOP;
END $$;

-- ============================================================================
-- Migration bookkeeping
-- ============================================================================

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at BIGINT NOT NULL
);

INSERT INTO schema_migrations (version, applied_at)
VALUES ('001_initial', (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT)
ON CONFLICT (version) DO NOTHING;
