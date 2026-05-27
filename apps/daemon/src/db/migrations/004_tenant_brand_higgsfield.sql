-- Higgsfield MCP credentials per tenant. Optional secondary video provider
-- that overrides the OpenRouter i2v path when enabled.
ALTER TABLE tenant_brand
  ADD COLUMN IF NOT EXISTS higgsfield_url TEXT NOT NULL DEFAULT 'https://higgsfield.ai/mcp',
  ADD COLUMN IF NOT EXISTS higgsfield_api_key TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS higgsfield_enabled BOOLEAN NOT NULL DEFAULT FALSE;
