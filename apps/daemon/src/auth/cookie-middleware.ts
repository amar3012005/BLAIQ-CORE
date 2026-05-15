// Cookie session middleware. Replaces auth/jwt-middleware.ts.

import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../db/tenant-context.js';
import { maybeRefreshOnRead, resolveSession } from './sessions.js';

const ALLOWLIST = new Set<string>([
  '/api/health',
  '/api/public-config',
  '/api/v1/auth/login',
  '/api/v1/auth/signup',
]);

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
