// Brand DNA + Brand Tone + Hivemind config — per-tenant.
// Always returns a row (auto-seeds on first read).

import { withTenant } from '../db/pool.js';

export interface TenantBrand {
  brandDnaMd: string;
  brandToneMd: string;
  hivemindUrl: string;
  hivemindApiKey: string;
  hivemindEnabled: boolean;
  higgsfieldUrl: string;
  higgsfieldApiKey: string;
  higgsfieldEnabled: boolean;
  pooolUrl: string;
  pooolApiKey: string;
  pooolEnabled: boolean;
  clickupEnabled: boolean;
  clickupListId: string;
  notifyEmailEnabled: boolean;
  notifySmtpHost: string;
  notifySmtpPort: number;
  notifySmtpUser: string;
  notifySmtpPass: string;
  notifyFrom: string;
  notifyRedirectTo: string;
  opsDailyCapUsd: number;
  studioGenPerHour: number;
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
              hivemind_enabled, higgsfield_url, higgsfield_api_key,
              higgsfield_enabled, poool_url, poool_api_key, poool_enabled,
              clickup_enabled, clickup_list_id,
              notify_email_enabled, notify_smtp_host, notify_smtp_port,
              notify_smtp_user, notify_smtp_pass, notify_from, notify_redirect_to,
              ops_daily_cap_usd, studio_gen_per_hour,
              updated_at
       FROM tenant_brand
       WHERE tenant_id = $1`,
      [tenantId],
    );
    if (result.rows.length === 0) {
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
        higgsfieldUrl: 'https://higgsfield.ai/mcp',
        higgsfieldApiKey: '',
        higgsfieldEnabled: false,
        pooolUrl: 'http://poool-mcp:8000/mcp',
        pooolApiKey: '',
        pooolEnabled: false,
        clickupEnabled: false,
        clickupListId: '',
        notifyEmailEnabled: false,
        notifySmtpHost: '',
        notifySmtpPort: 587,
        notifySmtpUser: '',
        notifySmtpPass: '',
        notifyFrom: '',
        notifyRedirectTo: '',
        opsDailyCapUsd: 100,
        studioGenPerHour: 20,
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
      higgsfieldUrl: row.higgsfield_url ?? 'https://higgsfield.ai/mcp',
      higgsfieldApiKey: row.higgsfield_api_key ?? '',
      higgsfieldEnabled: Boolean(row.higgsfield_enabled),
      pooolUrl: row.poool_url ?? 'http://poool-mcp:8000/mcp',
      pooolApiKey: row.poool_api_key ?? '',
      pooolEnabled: Boolean(row.poool_enabled),
      clickupEnabled: Boolean(row.clickup_enabled),
      clickupListId: row.clickup_list_id ?? '',
      notifyEmailEnabled: Boolean(row.notify_email_enabled),
      notifySmtpHost: row.notify_smtp_host ?? '',
      notifySmtpPort: Number(row.notify_smtp_port ?? 587),
      notifySmtpUser: row.notify_smtp_user ?? '',
      notifySmtpPass: row.notify_smtp_pass ?? '',
      notifyFrom: row.notify_from ?? '',
      notifyRedirectTo: row.notify_redirect_to ?? '',
      opsDailyCapUsd: Number(row.ops_daily_cap_usd ?? 100),
      studioGenPerHour: Number(row.studio_gen_per_hour ?? 20),
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
    if (patch.higgsfieldUrl !== undefined) {
      params.push(patch.higgsfieldUrl);
      sets.push(`higgsfield_url = $${params.length}`);
    }
    if (patch.higgsfieldApiKey !== undefined) {
      params.push(patch.higgsfieldApiKey);
      sets.push(`higgsfield_api_key = $${params.length}`);
    }
    if (patch.higgsfieldEnabled !== undefined) {
      params.push(patch.higgsfieldEnabled);
      sets.push(`higgsfield_enabled = $${params.length}`);
    }
    if (patch.pooolUrl !== undefined) {
      params.push(patch.pooolUrl);
      sets.push(`poool_url = $${params.length}`);
    }
    if (patch.pooolApiKey !== undefined) {
      params.push(patch.pooolApiKey);
      sets.push(`poool_api_key = $${params.length}`);
    }
    if (patch.pooolEnabled !== undefined) {
      params.push(patch.pooolEnabled);
      sets.push(`poool_enabled = $${params.length}`);
    }
    if (patch.clickupEnabled !== undefined) {
      params.push(patch.clickupEnabled);
      sets.push(`clickup_enabled = $${params.length}`);
    }
    if (patch.clickupListId !== undefined) {
      params.push(patch.clickupListId);
      sets.push(`clickup_list_id = $${params.length}`);
    }
    if (patch.notifyEmailEnabled !== undefined) {
      params.push(patch.notifyEmailEnabled);
      sets.push(`notify_email_enabled = $${params.length}`);
    }
    if (patch.notifySmtpHost !== undefined) {
      params.push(patch.notifySmtpHost);
      sets.push(`notify_smtp_host = $${params.length}`);
    }
    if (patch.notifySmtpPort !== undefined) {
      params.push(patch.notifySmtpPort);
      sets.push(`notify_smtp_port = $${params.length}`);
    }
    if (patch.notifySmtpUser !== undefined) {
      params.push(patch.notifySmtpUser);
      sets.push(`notify_smtp_user = $${params.length}`);
    }
    if (patch.notifySmtpPass !== undefined) {
      params.push(patch.notifySmtpPass);
      sets.push(`notify_smtp_pass = $${params.length}`);
    }
    if (patch.notifyFrom !== undefined) {
      params.push(patch.notifyFrom);
      sets.push(`notify_from = $${params.length}`);
    }
    if (patch.notifyRedirectTo !== undefined) {
      params.push(patch.notifyRedirectTo);
      sets.push(`notify_redirect_to = $${params.length}`);
    }
    if (patch.opsDailyCapUsd !== undefined) {
      params.push(patch.opsDailyCapUsd);
      sets.push(`ops_daily_cap_usd = $${params.length}`);
    }
    if (patch.studioGenPerHour !== undefined) {
      params.push(patch.studioGenPerHour);
      sets.push(`studio_gen_per_hour = $${params.length}`);
    }
    await client.query(
      `UPDATE tenant_brand SET ${sets.join(', ')} WHERE tenant_id = $1`,
      params,
    );
    const out = await client.query(
      `SELECT brand_dna_md, brand_tone_md, hivemind_url, hivemind_api_key,
              hivemind_enabled, higgsfield_url, higgsfield_api_key,
              higgsfield_enabled, poool_url, poool_api_key, poool_enabled,
              clickup_enabled, clickup_list_id,
              notify_email_enabled, notify_smtp_host, notify_smtp_port,
              notify_smtp_user, notify_smtp_pass, notify_from, notify_redirect_to,
              ops_daily_cap_usd, studio_gen_per_hour,
              updated_at
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
      higgsfieldUrl: row.higgsfield_url ?? 'https://higgsfield.ai/mcp',
      higgsfieldApiKey: row.higgsfield_api_key ?? '',
      higgsfieldEnabled: Boolean(row.higgsfield_enabled),
      pooolUrl: row.poool_url ?? 'http://poool-mcp:8000/mcp',
      pooolApiKey: row.poool_api_key ?? '',
      pooolEnabled: Boolean(row.poool_enabled),
      clickupEnabled: Boolean(row.clickup_enabled),
      clickupListId: row.clickup_list_id ?? '',
      notifyEmailEnabled: Boolean(row.notify_email_enabled),
      notifySmtpHost: row.notify_smtp_host ?? '',
      notifySmtpPort: Number(row.notify_smtp_port ?? 587),
      notifySmtpUser: row.notify_smtp_user ?? '',
      notifySmtpPass: row.notify_smtp_pass ?? '',
      notifyFrom: row.notify_from ?? '',
      notifyRedirectTo: row.notify_redirect_to ?? '',
      opsDailyCapUsd: Number(row.ops_daily_cap_usd ?? 100),
      studioGenPerHour: Number(row.studio_gen_per_hour ?? 20),
      updatedAt: Number(row.updated_at),
    };
  });
}
