-- 008_ops_brain_extras.sql
--
-- Ops Brain extras: LoopEngine state persistence (re-added per Track A.2
-- spec). Kept separate from 006 so future Track A.2 schema additions land
-- in this file rather than churning the main port migration.
--
-- LoopEngine state is per (tenant, team). One row per active loop holds
-- the cursor, last tick, and arbitrary engine state JSON. Matches the
-- daemon RLS pattern (GUC app.tenant_id, see db/tenant-context.ts).

CREATE SCHEMA IF NOT EXISTS ops;

-- ============================================================
-- ops.loop_states
-- ============================================================
CREATE TABLE IF NOT EXISTS ops.loop_states (
    id            UUID PRIMARY KEY,
    tenant_id     UUID NOT NULL,
    team_id       UUID NOT NULL,
    project_id    UUID,
    status        TEXT NOT NULL DEFAULT 'idle',
    cursor        TEXT NOT NULL DEFAULT '',
    last_tick_at  TIMESTAMPTZ,
    next_tick_at  TIMESTAMPTZ,
    tick_count    BIGINT NOT NULL DEFAULT 0,
    error_count   INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    state         JSONB NOT NULL DEFAULT '{}'::jsonb,
    config        JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ops_loop_states_tenant_team
    ON ops.loop_states (tenant_id, team_id);
CREATE INDEX IF NOT EXISTS ix_ops_loop_states_tenant_status
    ON ops.loop_states (tenant_id, status);
CREATE INDEX IF NOT EXISTS ix_ops_loop_states_tenant_next_tick
    ON ops.loop_states (tenant_id, next_tick_at)
    WHERE status NOT IN ('idle', 'stopped');
ALTER TABLE ops.loop_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON ops.loop_states;
CREATE POLICY tenant_isolation ON ops.loop_states
    USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
