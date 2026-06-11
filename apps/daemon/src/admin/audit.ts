// Audit log helper for the Ops Brain admin proxy.
//
// Mutating calls (POST/PUT/PATCH/DELETE) forwarded through
// /api/v1/admin/* are persisted to audit_log so we have a per-tenant
// record independent of the upstream sidecar.

import { withTenant } from '../db/pool.js';

export interface AuditEntry {
  tenantId: string;
  userId?: string;
  method: string;
  path: string;
  status: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function recordAudit(entry: AuditEntry): Promise<void> {
  if (!UUID_RE.test(entry.tenantId)) {
    // Dev tenant ('dev-tenant') is not a UUID; skip audit since RLS
    // requires UUID anyway. We surface this via logs only.
    // eslint-disable-next-line no-console
    console.warn('[admin-audit] skipping non-uuid tenant:', entry.tenantId);
    return;
  }
  const userId =
    entry.userId && UUID_RE.test(entry.userId) ? entry.userId : null;
  try {
    await withTenant(entry.tenantId, async (client) => {
      await client.query(
        `INSERT INTO audit_log (tenant_id, user_id, method, path, status)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.tenantId, userId, entry.method, entry.path, entry.status],
      );
    });
  } catch (err) {
    // Auditing must never break the proxied request.
    // eslint-disable-next-line no-console
    console.error('[admin-audit] insert failed:', (err as Error).message);
  }
}

export function isMutatingMethod(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'POST' || m === 'PUT' || m === 'PATCH' || m === 'DELETE';
}
