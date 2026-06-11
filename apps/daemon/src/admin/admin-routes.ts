// BLAIQ Ops Brain proxy — forwards /api/v1/admin/* to the AI Operations
// sidecar (forked AI-company → apps/ops-brain FastAPI) running at OPS_BRAIN_URL. Injects
// X-Tenant-Id from the authenticated session so the upstream can scope
// data per tenant. Refuses unauthenticated requests.
//
// Also proxies /admin-iframe/* for the dashboard SPA assets and WS
// handshakes so everything stays same-origin with BLAIQ web.
//
// Hardenings vs the original fetch-and-buffer:
//   1. Uses http.request and pipes the upstream IncomingMessage straight
//      into the express Response, so SSE/chunked responses flow through
//      chunk-by-chunk instead of being collected in memory.
//   2. Signs every forwarded request with X-Ops-Trust so the sidecar can
//      verify the call really came from this daemon (and not from anyone
//      who can reach the sidecar's port).
//   3. Records mutating calls to audit_log for per-tenant accountability.
//   4. Enforces a per-tenant daily cost cap (BLAIQ_OPS_DAILY_CAP_USD) by
//      summing ops.agent_activities.cost_usd before allowing new POSTs.

import crypto from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import type { Request, Response, Router } from 'express';
import type { AuthenticatedRequest } from '../db/tenant-context.js';
import { getPool } from '../db/pool.js';
import { isMutatingMethod, recordAudit } from './audit.js';

const OPS_BRAIN_URL = process.env.BLAIQ_OPS_BRAIN_URL || 'http://127.0.0.1:8010';
// Dashboard origin can differ from API origin in dev (Vite dev server on 3010).
// In prod the SPA gets built and served from the same FastAPI host so this
// defaults to OPS_BRAIN_URL.
const OPS_BRAIN_DASHBOARD_URL =
  process.env.BLAIQ_OPS_BRAIN_DASHBOARD_URL || 'http://127.0.0.1:3010';
const OPS_BRAIN_ENABLED =
  (process.env.BLAIQ_OPS_BRAIN_ENABLED || 'true').toLowerCase() !== 'false';

const DAILY_CAP_USD = (() => {
  const raw = process.env.BLAIQ_OPS_DAILY_CAP_USD;
  const parsed = raw ? Number(raw) : 100;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 100;
})();

const TRUST_TOKEN: string = (() => {
  const fromEnv = process.env.OPS_BRAIN_TRUST_TOKEN;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  const dev = crypto.randomBytes(32).toString('hex');
  // eslint-disable-next-line no-console
  console.warn(
    '[admin-proxy] OPS_BRAIN_TRUST_TOKEN unset; generated ephemeral dev token. ' +
      'Set OPS_BRAIN_TRUST_TOKEN to the same value on the sidecar in production.',
  );
  return dev;
})();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signTrust(tenantId: string, timestamp: string): string {
  return crypto
    .createHmac('sha256', TRUST_TOKEN)
    .update(`${tenantId}:${timestamp}`)
    .digest('hex');
}

async function checkDailyCap(tenantId: string): Promise<number | null> {
  if (!UUID_RE.test(tenantId)) return null;
  const pool = getPool();
  try {
    // Use raw pool: ops.agent_activities is the sidecar's own table and
    // may not exist yet (Track A creates it). The sidecar will own RLS on
    // its tables; here we just need the aggregate. We pass tenant_id as a
    // bound parameter so we can't read across tenants.
    const result = await pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(cost_usd), 0)::text AS total
         FROM ops.agent_activities
         WHERE tenant_id = $1
           AND created_at > date_trunc('day', now())`,
      [tenantId],
    );
    const total = Number(result.rows[0]?.total ?? '0');
    return Number.isFinite(total) ? total : 0;
  } catch (err) {
    // Table missing or sidecar schema not deployed — skip the guard.
    const code = (err as { code?: string }).code;
    if (code === '42P01' || code === '3F000') return null;
    // eslint-disable-next-line no-console
    console.warn('[admin-proxy] cost-cap query failed:', (err as Error).message);
    return null;
  }
}

function copySafeHeaders(
  src: http.IncomingMessage,
  dst: Response,
): void {
  for (const [key, value] of Object.entries(src.headers)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (
      lower === 'transfer-encoding' ||
      lower === 'content-length' ||
      lower === 'connection' ||
      lower === 'keep-alive'
    ) {
      continue;
    }
    dst.setHeader(key, value as string | string[]);
  }
}

function buildUpstreamHeaders(
  req: Request,
  tenantId: string,
  userId: string,
): http.OutgoingHttpHeaders {
  const ts = Date.now().toString();
  const headers: http.OutgoingHttpHeaders = {
    'X-Tenant-Id': tenantId,
    'X-User-Id': userId,
    'X-Ops-Trust': signTrust(tenantId, ts),
    'X-Ops-Trust-Ts': ts,
  };
  const ct = req.header('content-type');
  if (ct) headers['Content-Type'] = ct;
  const accept = req.header('accept');
  if (accept) headers['Accept'] = accept;
  return headers;
}

function serializeBody(req: Request, headers: http.OutgoingHttpHeaders): Buffer | undefined {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const body = req.body as unknown;
  if (body && typeof body === 'object' && !Buffer.isBuffer(body)) {
    const json = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(json).toString();
    return Buffer.from(json);
  }
  if (Buffer.isBuffer(body)) {
    headers['Content-Length'] = body.length.toString();
    return body;
  }
  return undefined;
}

async function proxy(
  req: Request,
  res: Response,
  stripPrefix: string,
  upstreamBase: string,
): Promise<void> {
  if (!OPS_BRAIN_ENABLED) {
    res.status(503).json({ error: 'ops-brain disabled' });
    return;
  }
  const authed = req as AuthenticatedRequest;
  const tenantId =
    authed.tenantId || (process.env.OD_SESSION_SECRET ? '' : 'dev-tenant');
  if (!tenantId) {
    res.status(401).json({ error: 'not authenticated' });
    return;
  }

  // Cost guardrail — only block new mutating work (not GETs).
  if (req.method === 'POST') {
    const spent = await checkDailyCap(tenantId);
    if (spent !== null && spent >= DAILY_CAP_USD) {
      res
        .status(429)
        .json({
          error: 'daily ops cost cap reached',
          spent_usd: spent,
          cap_usd: DAILY_CAP_USD,
        });
      return;
    }
  }

  const upstreamPath = req.originalUrl.startsWith(stripPrefix)
    ? req.originalUrl.slice(stripPrefix.length) || '/'
    : req.originalUrl;
  const target = new URL(upstreamPath, upstreamBase);
  const userId = authed.user?.userId || '';
  const headers = buildUpstreamHeaders(req, tenantId, userId);
  const body = serializeBody(req, headers);

  const transport = target.protocol === 'https:' ? https : http;
  const upstreamReq = transport.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers,
    },
    (upstreamRes) => {
      const status = upstreamRes.statusCode ?? 502;
      res.status(status);
      copySafeHeaders(upstreamRes, res);
      // Pipe chunk-by-chunk so SSE / chunked responses stream through.
      upstreamRes.pipe(res);
      upstreamRes.on('end', () => {
        if (isMutatingMethod(req.method)) {
          void recordAudit({
            tenantId,
            userId,
            method: req.method,
            path: upstreamPath,
            status,
          });
        }
      });
    },
  );

  upstreamReq.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[admin-proxy] upstream error:', err.message);
    if (!res.headersSent) {
      res
        .status(502)
        .json({ error: 'ops-brain unreachable', detail: err.message });
    } else {
      res.destroy(err);
    }
  });

  // If the client disconnects mid-stream, tear down the upstream too.
  req.on('close', () => {
    if (!upstreamReq.destroyed) upstreamReq.destroy();
  });

  if (body !== undefined) upstreamReq.write(body);
  upstreamReq.end();
}

export function registerAdminRoutes(router: Router): void {
  // JSON API surface → FastAPI
  router.use('/api/v1/admin', (req, res) => proxy(req, res, '/api/v1/admin', OPS_BRAIN_URL));
  // Iframe-embedded dashboard (HTML + JS + WS handshake) → Vite/static host
  router.use('/admin-iframe', (req, res) =>
    proxy(req, res, '/admin-iframe', OPS_BRAIN_DASHBOARD_URL),
  );
}
