// ERP (Poool MCP) configuration routes — GET/PUT/test endpoint mirroring
// the brand routes pattern. Lives outside brand-routes.ts so the ERP
// surface can grow independent endpoints (sync triggers, cache stats,
// project lookups) without bloating the brand handler.

import type { Request, Response, Router } from 'express';
import type { AuthenticatedRequest } from '../db/tenant-context.js';
import { getTenantBrand, updateTenantBrand } from '../brand/brand-store.js';
import { pooolApiCall } from './poool-client.js';

interface PooolConfigResponse {
  poool_url: string;
  poool_api_key_set: boolean;
  poool_api_key_preview: string;
  poool_enabled: boolean;
  updated_at: number;
}

function serialize(brand: Awaited<ReturnType<typeof getTenantBrand>>): PooolConfigResponse {
  return {
    poool_url: brand.pooolUrl,
    poool_api_key_set: brand.pooolApiKey.length > 0,
    poool_api_key_preview: brand.pooolApiKey
      ? `${brand.pooolApiKey.slice(0, 4)}…${brand.pooolApiKey.slice(-4)}`
      : '',
    poool_enabled: brand.pooolEnabled,
    updated_at: brand.updatedAt,
  };
}

export function registerErpRoutes(router: Router): void {
  router.get('/api/v1/org/erp', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    try {
      const brand = await getTenantBrand(authed.tenantId);
      res.status(200).json(serialize(brand));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[erp] get failed', err);
      res.status(500).json({ error: 'failed to load erp config' });
    }
  });

  router.put('/api/v1/org/erp', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId || !authed.user?.userId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    const body = (req.body ?? {}) as {
      poool_url?: string;
      poool_api_key?: string;
      poool_enabled?: boolean;
    };
    const patch: Parameters<typeof updateTenantBrand>[2] = {};
    if (typeof body.poool_url === 'string') patch.pooolUrl = body.poool_url;
    if (typeof body.poool_api_key === 'string') patch.pooolApiKey = body.poool_api_key;
    if (typeof body.poool_enabled === 'boolean') patch.pooolEnabled = body.poool_enabled;
    try {
      const brand = await updateTenantBrand(authed.tenantId, authed.user.userId, patch);
      res.status(200).json(serialize(brand));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[erp] update failed', err);
      res.status(500).json({ error: 'failed to save erp config' });
    }
  });

  router.post('/api/v1/org/erp/test', async (req: Request, res: Response) => {
    const authed = req as AuthenticatedRequest;
    if (!authed.tenantId) {
      res.status(401).json({ error: 'not authenticated' });
      return;
    }
    try {
      const brand = await getTenantBrand(authed.tenantId);
      if (!brand.pooolUrl) {
        res.status(200).json({ ok: false, error: 'no url configured' });
        return;
      }
      const resp = await pooolApiCall<{ serverInfo?: { name?: string } }>(
        brand.pooolUrl,
        brand.pooolApiKey,
        'initialize',
        {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'blaiq-test', version: '1.0' },
        },
      );
      if (resp.result) {
        res.status(200).json({
          ok: true,
          server: resp.result.serverInfo?.name ?? 'unknown',
        });
        return;
      }
      res.status(200).json({
        ok: false,
        error: resp.error?.message ?? 'unknown error',
      });
    } catch (err) {
      res.status(200).json({ ok: false, error: (err as Error).message });
    }
  });
}
