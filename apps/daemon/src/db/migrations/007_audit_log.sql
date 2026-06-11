-- Audit log for mutating admin proxy calls (Ops Brain sidecar).
-- Captures who did what against the upstream FastAPI surface so we can
-- reconstruct tenant activity without scraping the sidecar's own logs.

CREATE TABLE IF NOT EXISTS audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL,
  user_id    UUID,
  method     TEXT,
  path       TEXT,
  status     INT,
  at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_at
  ON audit_log (tenant_id, at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON audit_log;
CREATE POLICY tenant_isolation ON audit_log
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
