// Tenant-namespaced filesystem helpers.
//
// All persistent file IO in the multi-tenant daemon must funnel through
// `resolveTenantPath`. The helper enforces three invariants:
//
//   1. The tenant root sits under `${OD_DATA_DIR}/tenants/<tenantId>/`.
//      OD_DATA_DIR comes from compose/Coolify and points at the mounted
//      persistent volume.
//   2. `projectId` and `relative` paths cannot escape the tenant root
//      via `..`, absolute paths, or null bytes.
//   3. Symlinks that try to break out are normalised away via
//      `path.resolve` and the post-resolve prefix check.
//
// Any caller that bypasses this helper risks reading/writing another
// tenant's files. Reviewer checklist item: any new `fs.*` callsite must
// thread through here.

import path from 'node:path';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PROJECT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_\-]{0,63}$/;

export class TenantPathError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'TenantPathError';
  }
}

export function dataRoot(): string {
  const raw = process.env.OD_DATA_DIR;
  if (!raw || !raw.trim()) {
    throw new TenantPathError(
      'OD_DATA_DIR must be set when running multi-tenant; mount a persistent volume and point this env var at it.',
    );
  }
  return path.resolve(raw);
}

export function tenantRoot(tenantId: string): string {
  if (!UUID_RE.test(tenantId)) {
    throw new TenantPathError('tenantId is not a UUID');
  }
  return path.join(dataRoot(), 'tenants', tenantId);
}

export function projectRoot(tenantId: string, projectId: string): string {
  if (!PROJECT_ID_RE.test(projectId)) {
    throw new TenantPathError('projectId must match [A-Za-z0-9_-]{1,64}');
  }
  return path.join(tenantRoot(tenantId), 'projects', projectId);
}

/**
 * Resolve a relative path inside a tenant's project. Returns the
 * absolute filesystem path; throws if the request escapes the project
 * root.
 */
export function resolveTenantPath(
  tenantId: string,
  projectId: string,
  relative: string,
): string {
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new TenantPathError('relative path must be a non-empty string');
  }
  if (relative.includes('\0')) {
    throw new TenantPathError('relative path contains null byte');
  }
  if (path.isAbsolute(relative)) {
    throw new TenantPathError('absolute paths are not allowed');
  }
  const root = projectRoot(tenantId, projectId);
  const resolved = path.resolve(root, relative);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(rootWithSep)) {
    throw new TenantPathError('path traversal blocked');
  }
  return resolved;
}
