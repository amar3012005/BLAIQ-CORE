// Cookie session middleware. Replaces auth/jwt-middleware.ts.

import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../db/tenant-context.js';
import { maybeRefreshOnRead, resolveSession } from './sessions.js';

const ALLOWLIST = new Set<string>([
  '/api/health',
  '/api/public-config',
  '/api/v1/auth/login',
  '/api/v1/auth/signup',
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Trust window for ops-brain service calls (clock skew + in-flight latency).
const OPS_TRUST_MAX_AGE_MS = 5 * 60 * 1000;

// Verify a server-to-server call from the ops-brain sidecar (e.g. the ClickUp
// poller hitting /api/v1/org/clickup/sync). The sidecar signs
// HMAC(OPS_BRAIN_TRUST_TOKEN, `${tenantId}:${ts}`) — see
// apps/ops-brain/.../integrations/clickup.py. This is a *fallback* only: it
// runs after a normal session lookup misses, so it never weakens cookie auth.
// Returns the verified tenant id, or null if the headers are absent/invalid.
function verifyOpsTrust(req: Request): string | null {
  const token = process.env.OPS_BRAIN_TRUST_TOKEN;
  if (!token) return null;
  const tenantId = req.header('x-tenant-id');
  const ts = req.header('x-ops-trust-ts');
  const sig = req.header('x-ops-trust');
  if (!tenantId || !ts || !sig) return null;
  if (!UUID_RE.test(tenantId)) return null;
  const tsNum = Number(ts);
  if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > OPS_TRUST_MAX_AGE_MS) {
    return null;
  }
  const expected = crypto
    .createHmac('sha256', token)
    .update(`${tenantId}:${ts}`)
    .digest('hex');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return tenantId;
}

export function requireSession() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (ALLOWLIST.has(req.path)) {
      next();
      return;
    }
    if (!req.path.startsWith('/api/')) {
      next();
      return;
    }
    try {
      const session = await resolveSession(req);
      if (!session) {
        // Fallback: trusted ops-brain service call (no cookie). Verified by
        // shared-secret HMAC; sets the tenant and proceeds as a service user.
        const trustedTenant = verifyOpsTrust(req);
        if (trustedTenant) {
          const authed = req as AuthenticatedRequest;
          authed.user = { userId: 'ops-brain-service', tenantId: trustedTenant, email: '' };
          authed.tenantId = trustedTenant;
          next();
          return;
        }
        res.status(401).json({ error: 'not authenticated' });
        return;
      }
      const refreshed = await maybeRefreshOnRead(req, res, session);
      const authed = req as AuthenticatedRequest;
      authed.user = {
        userId: refreshed.userId,
        tenantId: refreshed.tenantId,
        email: '',
      };
      authed.tenantId = refreshed.tenantId;
      next();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[auth] session resolve failed', (err as Error).message);
      res.status(401).json({ error: 'session error' });
    }
  };
}
