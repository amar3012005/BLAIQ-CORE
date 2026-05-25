// Brand DNA + Brand Tone + Hivemind config — per-tenant.
// Always returns a row (auto-seeds on first read).

import { withTenant } from '../db/pool.js';

export interface TenantBrand {
  brandDnaMd: string;
  brandToneMd: string;
  hivemindUrl: string;
  hivemindApiKey: string;
  hivemindEnabled: boolean;
  updatedAt: number;
}

const DEFAULT_DNA = `# Brand DNA

## Logo
- Primary mark:
- Wordmark:
- Clearspace:

## Color
- Primary ink: #111111
- Background: #F1F0EC
- Accent:
- Muted: #6E6A63

## Typography
- Display:
- Body:
- Mono labels:

## Texture
- Card bg:
- Border style:
- Shadow rules:

## Iconography

## Photography / Media
`;

const DEFAULT_TONE = `# Brand Tone

## Personality

## Voice Pillars
1.
2.
3.

## Vocabulary
### Always use

### Never use

## Examples
**Bad**:
**Good**:

## Grammar

## Tagline patterns
`;

export async function getTenantBrand(tenantId: string): Promise<TenantBrand> {
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `SELECT brand_dna_md, brand_tone_md, hivemind_url, hivemind_api_key,
              hivemind_enabled, updated_at
       FROM tenant_brand
       WHERE tenant_id = $1`,
      [tenantId],
    );
    if (result.rows.length === 0) {
      // Seed default row
      const now = Date.now();
      await client.query(
        `INSERT INTO tenant_brand
           (tenant_id, brand_dna_md, brand_tone_md, updated_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (tenant_id) DO NOTHING`,
        [tenantId, DEFAULT_DNA, DEFAULT_TONE, now],
      );
      return {
        brandDnaMd: DEFAULT_DNA,
        brandToneMd: DEFAULT_TONE,
        hivemindUrl: 'https://core.hivemind.davinciai.eu:8050/api/mcp',
        hivemindApiKey: '',
        hivemindEnabled: false,
        updatedAt: now,
      };
    }
    const row = result.rows[0];
    return {
      brandDnaMd: row.brand_dna_md ?? '',
      brandToneMd: row.brand_tone_md ?? '',
      hivemindUrl: row.hivemind_url ?? '',
      hivemindApiKey: row.hivemind_api_key ?? '',
      hivemindEnabled: Boolean(row.hivemind_enabled),
      updatedAt: Number(row.updated_at),
    };
  });
}

export async function updateTenantBrand(
  tenantId: string,
  userId: string,
  patch: Partial<TenantBrand>,
): Promise<TenantBrand> {
  await getTenantBrand(tenantId); // ensure row exists
  return withTenant(tenantId, async (client) => {
    const now = Date.now();
    const sets: string[] = ['updated_at = $2', 'updated_by = $3'];
    const params: unknown[] = [tenantId, now, userId];
    if (patch.brandDnaMd !== undefined) {
      params.push(patch.brandDnaMd);
      sets.push(`brand_dna_md = $${params.length}`);
    }
    if (patch.brandToneMd !== undefined) {
      params.push(patch.brandToneMd);
      sets.push(`brand_tone_md = $${params.length}`);
    }
    if (patch.hivemindUrl !== undefined) {
      params.push(patch.hivemindUrl);
      sets.push(`hivemind_url = $${params.length}`);
    }
    if (patch.hivemindApiKey !== undefined) {
      params.push(patch.hivemindApiKey);
      sets.push(`hivemind_api_key = $${params.length}`);
    }
    if (patch.hivemindEnabled !== undefined) {
      params.push(patch.hivemindEnabled);
      sets.push(`hivemind_enabled = $${params.length}`);
    }
    await client.query(
      `UPDATE tenant_brand SET ${sets.join(', ')} WHERE tenant_id = $1`,
      params,
    );
    const out = await client.query(
      `SELECT brand_dna_md, brand_tone_md, hivemind_url, hivemind_api_key,
              hivemind_enabled, updated_at
       FROM tenant_brand WHERE tenant_id = $1`,
      [tenantId],
    );
    const row = out.rows[0];
    return {
      brandDnaMd: row.brand_dna_md ?? '',
      brandToneMd: row.brand_tone_md ?? '',
      hivemindUrl: row.hivemind_url ?? '',
      hivemindApiKey: row.hivemind_api_key ?? '',
      hivemindEnabled: Boolean(row.hivemind_enabled),
      updatedAt: Number(row.updated_at),
    };
  });
}
