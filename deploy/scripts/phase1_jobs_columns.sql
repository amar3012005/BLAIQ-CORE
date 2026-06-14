-- Phase 1 schema: itemised third-party costs + invoice payment due date.
--
-- The Alembic chain is unreliable on the production DB (it assumes a prior
-- SQLite→Postgres path), so we apply Phase 1 columns directly and then stamp
-- Alembic at the matching revision. Both statements are idempotent.
--
-- Usage on the server:
--   docker exec -i open-design-postgres psql -U open_design -d open_design \
--     < deploy/scripts/phase1_jobs_columns.sql
--   docker exec ops-brain alembic stamp c4d8a2f1e9b7

ALTER TABLE ops.jobs ADD COLUMN IF NOT EXISTS cost_items jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE ops.jobs ADD COLUMN IF NOT EXISTS payment_due_date date;
