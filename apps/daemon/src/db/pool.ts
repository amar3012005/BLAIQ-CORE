// Postgres connection pool for the daemon. Replaces better-sqlite3.
//
// The daemon holds a single pg.Pool for the lifetime of the process. Every
// authenticated request runs inside `withTenant`, which checks out a client,
// binds `app.tenant_id` as a session-scoped GUC, and runs the caller's work
// against that client. RLS policies in 001_initial.sql consult the GUC to
// reject any row whose tenant_id does not match.

import { Pool, PoolClient } from 'pg';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (pool) return pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is required for the multi-tenant Postgres deploy. ' +
        'Set it in your environment (Coolify env or .env.production).',
    );
  }
  pool = new Pool({
    connectionString,
    max: Number(process.env.OD_PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Require TLS in production. Coolify-managed Postgres typically uses an
    // internal network without TLS, so we accept self-signed certs when
    // OD_PG_SSL=relaxed. For external Postgres providers (Neon, Supabase),
    // set OD_PG_SSL=strict to enforce certificate validation.
    ssl: pgSslOption(),
  });
  pool.on('error', (err) => {
    // A connection-level error should not crash the daemon; surface it in
    // logs and let the next checkout reconnect.
    // eslint-disable-next-line no-console
    console.error('[pg pool] idle client error', err);
  });
  return pool;
}

function pgSslOption(): false | { rejectUnauthorized: boolean } {
  const mode = (process.env.OD_PG_SSL ?? '').toLowerCase();
  if (mode === 'strict') return { rejectUnauthorized: true };
  if (mode === 'relaxed') return { rejectUnauthorized: false };
  if (mode === 'disable' || mode === 'off' || mode === '') return false;
  return { rejectUnauthorized: true };
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}

/**
 * Run `fn` against a checked-out Postgres client with `app.tenant_id`
 * bound for the duration of the callback. The session GUC is bound via
 * `SET LOCAL` inside an explicit transaction so RLS policies always see
 * the right tenant.
 *
 * IMPORTANT: every DB read or write performed on behalf of a tenant
 * request MUST go through this helper. Bypassing it (using the raw pool
 * directly) is a security bug — RLS will return zero rows, masking the
 * defect at first but leaving us one config slip away from cross-tenant
 * leakage.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!isUuid(tenantId)) {
    throw new Error('withTenant: tenantId must be a UUID');
  }
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    // set_config(name, value, is_local=true) is the parameterized form of
    // SET LOCAL and is safe against injection.
    await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore rollback errors; the outer error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Escape hatch for operations that must bypass tenant scoping: user
 * sign-up, tenant provisioning, internal admin tooling. Use sparingly.
 */
export async function withoutTenant<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

// ---------- migrations ----------

const MIGRATIONS_DIR_REL = './migrations';

export async function runMigrations(): Promise<void> {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    MIGRATIONS_DIR_REL,
  );
  let entries: string[];
  try {
    entries = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  } catch (err) {
    throw new Error(
      `Migration directory not found at ${dir}. Ensure the build copies migrations/ to dist/db/.`,
      { cause: err },
    );
  }
  await withoutTenant(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at BIGINT NOT NULL
      );
    `);
    for (const file of entries) {
      const version = file.replace(/\.sql$/i, '');
      const already = await client.query(
        `SELECT 1 FROM schema_migrations WHERE version = $1`,
        [version],
      );
      if ((already.rowCount ?? 0) > 0) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)
             ON CONFLICT (version) DO NOTHING`,
          [version, Date.now()],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, {
          cause: err,
        });
      }
    }
  });
}
