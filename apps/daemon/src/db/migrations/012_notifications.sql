-- Outbound notifications log (Track A6). Records every delivery notice and
-- payment reminder the system raises. A pluggable notifier marks them
-- 'sent' once a real email/Protonet channel is configured; until then they're
-- 'logged' so the workflow is fully auditable without an external provider.
CREATE SCHEMA IF NOT EXISTS ops;

CREATE TABLE IF NOT EXISTS ops.notifications (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL,
  job_id      UUID,
  kind        TEXT NOT NULL,                 -- delivery | payment_overdue | payment_reminder
  channel     TEXT NOT NULL DEFAULT 'log',   -- log | email | protonet
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'logged',-- logged | sent | failed
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notifications_tenant_created_idx
  ON ops.notifications (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_tenant_job_idx
  ON ops.notifications (tenant_id, job_id);

ALTER TABLE ops.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notifications_tenant_isolation ON ops.notifications;
CREATE POLICY notifications_tenant_isolation ON ops.notifications
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
