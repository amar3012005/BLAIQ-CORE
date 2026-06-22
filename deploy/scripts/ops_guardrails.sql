-- Phase 2: Per-tenant ops guardrails in tenant_brand.
-- Idempotent (ADD COLUMN IF NOT EXISTS). Apply with:
-- docker exec -i open-design-postgres psql -U open_design -d open_design < /opt/BLAIQ-CORE/deploy/scripts/ops_guardrails.sql

ALTER TABLE tenant_brand
  ADD COLUMN IF NOT EXISTS ops_daily_cap_usd   numeric(10,2) NOT NULL DEFAULT 100.00,
  ADD COLUMN IF NOT EXISTS studio_gen_per_hour integer        NOT NULL DEFAULT 20;
