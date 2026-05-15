// Tenant context propagation for the daemon.
//
// Express requests authenticated by the Supabase JWT middleware (see
// apps/daemon/src/auth/) attach `req.tenantId`. Route handlers wrap their
// DB work in `runForTenant(req, fn)`, which forwards to withTenant() from
// db/pool.ts. We keep this thin layer separate so the auth middleware
// shape and the DB pool stay decoupled.

import type { Request } from 'express';
import type { PoolClient } from 'pg';
import { withTenant } from './pool.js';

export interface AuthenticatedRequest extends Request {
  user?: { userId: string; tenantId: string; email: string };
  tenantId?: string;
}

export function requireTenantId(req: AuthenticatedRequest): string {
  const tenantId = req.tenantId ?? req.user?.tenantId;
  if (!tenantId) {
    throw new TenantContextMissingError();
  }
  return tenantId;
}

export class TenantContextMissingError extends Error {
  readonly status = 401;
  constructor() {
    super('tenant context missing on request');
    this.name = 'TenantContextMissingError';
  }
}

export function runForTenant<T>(
  req: AuthenticatedRequest,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  return withTenant(requireTenantId(req), fn);
}
