-- Brand DNA + Brand Tone per tenant + Hivemind MCP config
-- Each tenant has exactly one brand row. Auto-seeded on tenant create.

CREATE TABLE IF NOT EXISTS tenant_brand (
  tenant_id          UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  brand_dna_md       TEXT NOT NULL DEFAULT '',
  brand_tone_md      TEXT NOT NULL DEFAULT '',
  hivemind_url       TEXT NOT NULL DEFAULT 'https://core.hivemind.davinciai.eu:8050/api/mcp',
  hivemind_api_key   TEXT NOT NULL DEFAULT '',
  hivemind_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at         BIGINT NOT NULL,
  updated_by         UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS tenant_brand_enabled_idx
  ON tenant_brand(hivemind_enabled) WHERE hivemind_enabled = TRUE;

-- Seed brand row for every existing tenant
INSERT INTO tenant_brand (tenant_id, updated_at)
SELECT id, EXTRACT(EPOCH FROM NOW()) * 1000 FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- RLS: tenant_brand rows scoped by app.tenant_id GUC
ALTER TABLE tenant_brand ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON tenant_brand;
CREATE POLICY tenant_isolation ON tenant_brand
  USING (tenant_id = app_current_tenant())
  WITH CHECK (tenant_id = app_current_tenant());
