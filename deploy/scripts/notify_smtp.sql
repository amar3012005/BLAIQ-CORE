-- Phase 1: Add SMTP notification config to tenant_brand.
-- Idempotent (ADD COLUMN IF NOT EXISTS). Apply with:
-- docker exec -i open-design-postgres psql -U open_design -d open_design < /opt/BLAIQ-CORE/deploy/scripts/notify_smtp.sql

ALTER TABLE tenant_brand
  ADD COLUMN IF NOT EXISTS notify_email_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notify_smtp_host     text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notify_smtp_port     integer NOT NULL DEFAULT 587,
  ADD COLUMN IF NOT EXISTS notify_smtp_user     text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notify_smtp_pass     text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notify_from          text    NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS notify_redirect_to   text    NOT NULL DEFAULT '';
