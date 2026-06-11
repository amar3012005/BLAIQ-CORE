-- Poool ERP read-through cache, populated by the Ops Brain sidecar.
-- Per-tenant rows (RLS-enforced) keyed by (tenant_id, kind, project_external_id).
-- `kind` distinguishes timetrack_time, order, invoice, project, etc.

CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.poool_cache (
  id               BIGSERIAL PRIMARY KEY,
  tenant_id        UUID NOT NULL,
  kind             TEXT NOT NULL,
  project_external_id TEXT,
  external_id      TEXT,
  payload          JSONB NOT NULL,
  fetched_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS poool_cache_tenant_kind_idx
  ON ops.poool_cache (tenant_id, kind);
CREATE INDEX IF NOT EXISTS poool_cache_tenant_project_idx
  ON ops.poool_cache (tenant_id, project_external_id);
CREATE UNIQUE INDEX IF NOT EXISTS poool_cache_tenant_kind_ext_uniq
  ON ops.poool_cache (tenant_id, kind, external_id)
  WHERE external_id IS NOT NULL;

ALTER TABLE ops.poool_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS poool_cache_tenant_isolation ON ops.poool_cache;
CREATE POLICY poool_cache_tenant_isolation ON ops.poool_cache
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
