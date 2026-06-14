-- ClickUp integration config per tenant. The Ops Brain ClickUp poller reads
-- `clickup_enabled` to decide whether to sync, and `clickup_list_id` as the
-- default list to push job tickets into. OAuth itself is held by the daemon's
-- Composio connector, so no API key lives here. Mirrors the poool_* pattern.
ALTER TABLE tenant_brand
  ADD COLUMN IF NOT EXISTS clickup_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS clickup_list_id TEXT NOT NULL DEFAULT '';
