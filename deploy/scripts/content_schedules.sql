-- BLAIQ content scheduling/automation — recurring on-brand content.
-- Two tenant-scoped tables (RLS mirrors ops.jobs): the schedule definitions and
-- the generated drafts ("runs"). Applied manually on prod (alembic chain is
-- unreliable there); idempotent.

CREATE TABLE IF NOT EXISTS ops.content_schedules (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  platform    text NOT NULL DEFAULT 'linkedin',
  topic       text NOT NULL,
  lang        text NOT NULL DEFAULT '',
  cadence     text NOT NULL DEFAULT 'weekly',   -- 'daily' | 'weekly'
  enabled     boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT NOW(),
  runs        integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE ops.content_schedules ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_schedules_tenant_isolation ON ops.content_schedules;
CREATE POLICY content_schedules_tenant_isolation ON ops.content_schedules
  USING (tenant_id::text = current_setting('app.tenant_id', true));
CREATE INDEX IF NOT EXISTS idx_content_schedules_tenant ON ops.content_schedules (tenant_id);
CREATE INDEX IF NOT EXISTS idx_content_schedules_due ON ops.content_schedules (enabled, next_run_at);

CREATE TABLE IF NOT EXISTS ops.content_runs (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  schedule_id uuid,
  platform    text NOT NULL,
  title       text NOT NULL DEFAULT '',
  body        text NOT NULL DEFAULT '',
  hashtags    jsonb NOT NULL DEFAULT '[]',
  share_url   text,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);
ALTER TABLE ops.content_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS content_runs_tenant_isolation ON ops.content_runs;
CREATE POLICY content_runs_tenant_isolation ON ops.content_runs
  USING (tenant_id::text = current_setting('app.tenant_id', true));
CREATE INDEX IF NOT EXISTS idx_content_runs_tenant ON ops.content_runs (tenant_id, created_at DESC);
