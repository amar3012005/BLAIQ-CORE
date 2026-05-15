// Cookie session auth (replicating HIVEMIND/BLAIQ AuthProvider).
//
// Flow:
//   1. POST /api/v1/auth/login { email, password } verifies bcrypt
//      hash; on success inserts a sessions row and sets a signed
//      httpOnly cookie `od_session=<sessionId>.<sig>`.
//   2. Subsequent requests carry the cookie; middleware verifies the
//      signature, loads the session, attaches { userId, tenantId } to
//      req. Expired or revoked sessions return 401.
//   3. POST /api/v1/auth/refresh extends expires_at and rotates the
//      session id to mitigate fixation.
//   4. POST /api/v1/auth/logout revokes the session.
//   5. GET /api/v1/auth/bootstrap returns the rich payload the
//      frontend AuthProvider expects (user/org/roles/permissions/
//      workspace_memberships/feature_flags/onboarding/connectivity/
//      client_support).
//
// Cookie security:
//   - Signed with HMAC-SHA256 using `OD_SESSION_SECRET` (>=32 bytes
//     random).
//   - `httpOnly` so JS cannot read it (CSRF still possible — see csrf.ts
//     for the double-submit token).
//   - `secure` in production (HTTPS only). Set `OD_COOKIE_INSECURE=1`
//     for local dev over HTTP.
//   - `sameSite=lax` so cross-origin form posts don't leak it; the
//     frontend hits the API on a subdomain (api.<domain>) which keeps
//     it same-site under registrable domain rules.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { withTenant, withoutTenant } from '../db/pool.js';
import type { PoolClient } from 'pg';

const COOKIE_NAME = 'od_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days
const REFRESH_WINDOW_MS = 1000 * 60 * 60 * 24; // refresh if older than 24h

export interface SessionRecord {
  id: string;
  userId: string;
  tenantId: string;
  issuedAt: number;
  refreshedAt: number;
  expiresAt: number;
}

export interface BootstrapResponse {
  user: {
    id: string;
    email: string;
    display_name: string;
    role: string;
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  roles: string[];
  permissions: string[];
  workspace_memberships: Array<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>;
  feature_flags: Record<string, boolean>;
  onboarding: { completed: boolean; step: string } | null;
  connectivity: { core_api_base_url: string; core_health: string } | null;
  client_support: string[];
}

function sessionSecret(): Buffer {
  const raw = process.env.OD_SESSION_SECRET;
  if (!raw || raw.length < 32) {
    throw new Error(
      'OD_SESSION_SECRET must be set to a random secret of at least 32 chars',
    );
  }
  return Buffer.from(raw, 'utf8');
}

function sign(value: string): string {
  return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function pack(sessionId: string): string {
  return `${sessionId}.${sign(sessionId)}`;
}

function unpack(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = sign(id);
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length) return null;
  if (!timingSafeEqual(a, b)) return null;
  return id;
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function readSessionCookie(req: Request): string | null {
  const cookies = parseCookies(req.headers.cookie);
  const raw = cookies[COOKIE_NAME];
  if (!raw) return null;
  return unpack(raw);
}

function writeSessionCookie(res: Response, sessionId: string, expiresAt: number) {
  const insecure = process.env.OD_COOKIE_INSECURE === '1';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(pack(sessionId))}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (!insecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res: Response) {
  const insecure = process.env.OD_COOKIE_INSECURE === '1';
  const parts = [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (!insecure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function loadSession(client: PoolClient, sessionId: string): Promise<SessionRecord | null> {
  const res = await client.query<{
    id: string;
    user_id: string;
    tenant_id: string;
    issued_at: string;
    refreshed_at: string;
    expires_at: string;
    revoked_at: string | null;
  }>(
    `SELECT id, user_id, tenant_id, issued_at, refreshed_at, expires_at, revoked_at
       FROM sessions WHERE id = $1`,
    [sessionId],
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.revoked_at) return null;
  const expiresAt = Number(row.expires_at);
  if (expiresAt <= Date.now()) return null;
  return {
    id: row.id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    issuedAt: Number(row.issued_at),
    refreshedAt: Number(row.refreshed_at),
    expiresAt,
  };
}

export async function resolveSession(req: Request): Promise<SessionRecord | null> {
  const sessionId = readSessionCookie(req);
  if (!sessionId) return null;
  return withoutTenant((client) => loadSession(client, sessionId));
}

export async function login(
  req: Request,
  res: Response,
  email: string,
  password: string,
): Promise<{ session: SessionRecord; bootstrap: BootstrapResponse } | { error: string; status: number }> {
  const cleanedEmail = email.trim().toLowerCase();
  if (!cleanedEmail || !password) {
    return { error: 'email and password required', status: 400 };
  }
  return withoutTenant(async (client) => {
    const userRow = await client.query<{
      id: string;
      email: string;
      display_name: string | null;
      role: string;
      password_hash: string | null;
      primary_tenant_id: string;
      locked_at: string | null;
    }>(
      `SELECT id, email, display_name, role, password_hash,
              primary_tenant_id, locked_at
         FROM users WHERE email = $1`,
      [cleanedEmail],
    );
    const user = userRow.rows[0];
    if (!user || !user.password_hash) {
      // Run a dummy bcrypt to keep timing constant against email
      // enumeration.
      await bcrypt.compare(password, '$2a$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV');
      return { error: 'invalid credentials', status: 401 };
    }
    if (user.locked_at) {
      return { error: 'account locked', status: 403 };
    }
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return { error: 'invalid credentials', status: 401 };
    }
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    const sessionRes = await client.query<{ id: string }>(
      `INSERT INTO sessions
         (user_id, tenant_id, user_agent, ip,
          issued_at, refreshed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6)
       RETURNING id`,
      [
        user.id,
        user.primary_tenant_id,
        (req.headers['user-agent'] ?? '').toString().slice(0, 500) || null,
        (req.ip ?? null),
        now,
        expiresAt,
      ],
    );
    await client.query(
      `UPDATE users SET last_login_at = $1, updated_at = $1 WHERE id = $2`,
      [now, user.id],
    );
    const sessionId = sessionRes.rows[0]!.id;
    writeSessionCookie(res, sessionId, expiresAt);
    const session: SessionRecord = {
      id: sessionId,
      userId: user.id,
      tenantId: user.primary_tenant_id,
      issuedAt: now,
      refreshedAt: now,
      expiresAt,
    };
    const bootstrap = await buildBootstrap(client, session);
    return { session, bootstrap };
  });
}

export async function refresh(
  req: Request,
  res: Response,
): Promise<{ session: SessionRecord; bootstrap: BootstrapResponse } | { error: string; status: number }> {
  const sessionId = readSessionCookie(req);
  if (!sessionId) return { error: 'no session', status: 401 };
  return withoutTenant(async (client) => {
    const existing = await loadSession(client, sessionId);
    if (!existing) return { error: 'session invalid', status: 401 };
    const now = Date.now();
    const expiresAt = now + SESSION_TTL_MS;
    // Rotate the session id to mitigate fixation.
    const newId = await client.query<{ id: string }>(
      `INSERT INTO sessions
         (user_id, tenant_id, user_agent, ip,
          issued_at, refreshed_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6)
       RETURNING id`,
      [
        existing.userId,
        existing.tenantId,
        (req.headers['user-agent'] ?? '').toString().slice(0, 500) || null,
        (req.ip ?? null),
        now,
        expiresAt,
      ],
    );
    await client.query(
      `UPDATE sessions SET revoked_at = $1 WHERE id = $2`,
      [now, existing.id],
    );
    const session: SessionRecord = {
      id: newId.rows[0]!.id,
      userId: existing.userId,
      tenantId: existing.tenantId,
      issuedAt: existing.issuedAt,
      refreshedAt: now,
      expiresAt,
    };
    writeSessionCookie(res, session.id, expiresAt);
    const bootstrap = await buildBootstrap(client, session);
    return { session, bootstrap };
  });
}

export async function logout(req: Request, res: Response): Promise<void> {
  const sessionId = readSessionCookie(req);
  clearSessionCookie(res);
  if (!sessionId) return;
  await withoutTenant(async (client) => {
    await client.query(
      `UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL`,
      [Date.now(), sessionId],
    );
  });
}

export async function maybeRefreshOnRead(req: Request, res: Response, session: SessionRecord): Promise<SessionRecord> {
  if (Date.now() - session.refreshedAt < REFRESH_WINDOW_MS) return session;
  await withoutTenant(async (client) => {
    await client.query(
      `UPDATE sessions SET refreshed_at = $1, expires_at = $2 WHERE id = $3`,
      [Date.now(), Date.now() + SESSION_TTL_MS, session.id],
    );
  });
  writeSessionCookie(res, session.id, Date.now() + SESSION_TTL_MS);
  return { ...session, refreshedAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS };
}

async function buildBootstrap(client: PoolClient, session: SessionRecord): Promise<BootstrapResponse> {
  const userRow = await client.query<{
    id: string;
    email: string;
    display_name: string | null;
    role: string;
  }>(
    `SELECT id, email, display_name, role FROM users WHERE id = $1`,
    [session.userId],
  );
  const tenantRow = await client.query<{
    id: string;
    name: string;
    slug: string;
  }>(`SELECT id, name, slug FROM tenants WHERE id = $1`, [session.tenantId]);
  const memberships = await client.query<{
    id: string;
    name: string;
    slug: string;
    role: string;
  }>(
    `SELECT w.id, w.name, w.slug, wm.role
       FROM workspace_memberships wm
       JOIN workspaces w ON w.id = wm.workspace_id
      WHERE wm.user_id = $1 AND w.tenant_id = $2`,
    [session.userId, session.tenantId],
  );
  const flagsRow = await withTenant(session.tenantId, async (txn) =>
    txn.query<{ flag: string; enabled: boolean }>(
      `SELECT flag, enabled FROM tenant_feature_flags`,
    ),
  );
  const flags: Record<string, boolean> = {};
  for (const f of flagsRow.rows) flags[f.flag] = f.enabled;
  const user = userRow.rows[0]!;
  const tenant = tenantRow.rows[0]!;
  const role = user.role || 'member';
  const roles = [role];
  const permissions = role === 'admin' || role === 'owner' ? ['*'] : [];
  return {
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name ?? user.email,
      role,
    },
    organization: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
    },
    roles,
    permissions,
    workspace_memberships: memberships.rows,
    feature_flags: flags,
    onboarding: { completed: true, step: 'done' },
    connectivity: {
      core_api_base_url: process.env.API_DOMAIN
        ? `https://${process.env.API_DOMAIN}`
        : '',
      core_health: 'ok',
    },
    client_support: ['claude', 'codex', 'web'],
  };
}

export async function bootstrapForSession(session: SessionRecord): Promise<BootstrapResponse> {
  return withoutTenant((client) => buildBootstrap(client, session));
}

export async function createUser(input: {
  email: string;
  password: string;
  displayName?: string;
  role?: 'admin' | 'owner' | 'member';
  tenantName?: string;
}): Promise<{ userId: string; tenantId: string }> {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password) {
    throw new Error('email and password required');
  }
  if (input.password.length < 8) {
    throw new Error('password must be at least 8 characters');
  }
  const hash = await bcrypt.hash(input.password, 12);
  const now = Date.now();
  return withoutTenant(async (client) => {
    await client.query('BEGIN');
    try {
      const tenantSlug = (input.tenantName ?? email.split('@')[0] ?? 'tenant')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'tenant';
      const tenant = await client.query<{ id: string }>(
        `INSERT INTO tenants (name, slug, created_at, updated_at)
         VALUES ($1, $2, $3, $3)
         RETURNING id`,
        [input.tenantName ?? email, `${tenantSlug}-${randomBytes(3).toString('hex')}`, now],
      );
      const tenantId = tenant.rows[0]!.id;
      const user = await client.query<{ id: string }>(
        `INSERT INTO users
           (email, password_hash, display_name, role, primary_tenant_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING id`,
        [
          email,
          hash,
          input.displayName ?? email,
          input.role ?? 'owner',
          tenantId,
          now,
        ],
      );
      const userId = user.rows[0]!.id;
      await client.query(
        `INSERT INTO tenant_members (tenant_id, user_id, role, created_at)
         VALUES ($1, $2, $3, $4)`,
        [tenantId, userId, input.role ?? 'owner', now],
      );
      const workspace = await client.query<{ id: string }>(
        `INSERT INTO workspaces (tenant_id, name, slug, created_at)
         VALUES ($1, $2, 'default', $3)
         RETURNING id`,
        [tenantId, 'Default Workspace', now],
      );
      await client.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role, created_at)
         VALUES ($1, $2, $3, $4)`,
        [workspace.rows[0]!.id, userId, input.role ?? 'owner', now],
      );
      await client.query('COMMIT');
      return { userId, tenantId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
