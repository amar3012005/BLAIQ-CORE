-- Poool ERP MCP credentials per tenant. Optional integration that the Ops
-- Brain uses to pull timetrack, orders, and invoices for project margin
-- analytics. Mirrors the hivemind/higgsfield column pattern.
ALTER TABLE tenant_brand
  ADD COLUMN IF NOT EXISTS poool_url TEXT NOT NULL DEFAULT 'http://poool-mcp:8888',
  ADD COLUMN IF NOT EXISTS poool_api_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS poool_enabled BOOLEAN NOT NULL DEFAULT FALSE;
