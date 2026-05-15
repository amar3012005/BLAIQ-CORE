// Per-tenant rate and budget enforcement.
//
// We enforce three caps in v1:
//   1. Concurrent agent runs per tenant (default 2). Hard cap; new runs
//      get HTTP 429.
//   2. Daily token budget (default 1,000,000 tokens). Tracked in
//      tenant_usage. New runs rejected when the day's tokens exceed the
//      tenant's quota_tokens_per_day.
//   3. Per-tenant request rate (default 60/min). Token-bucket in memory.
//
// In-memory state is fine for v1 because the daemon is single-instance.
// When we scale horizontally, replace the in-memory maps with a Redis
// or Postgres advisory-lock backed shared store.

import type { PoolClient } from 'pg';

const RATE_BUCKET_CAPACITY = Number(process.env.OD_RATE_PER_MIN ?? 60);
const RATE_REFILL_PER_MS = RATE_BUCKET_CAPACITY / 60_000;

interface RateBucket {
  tokens: number;
  lastRefill: number;
}

const rateBuckets = new Map<string, RateBucket>();
const concurrentRuns = new Map<string, number>();

export class QuotaExceededError extends Error {
  readonly status = 429;
  constructor(message: string, readonly reason: 'rate' | 'concurrency' | 'tokens') {
    super(message);
    this.name = 'QuotaExceededError';
  }
}

export function checkRate(tenantId: string): void {
  const now = Date.now();
  let bucket = rateBuckets.get(tenantId);
  if (!bucket) {
    bucket = { tokens: RATE_BUCKET_CAPACITY, lastRefill: now };
    rateBuckets.set(tenantId, bucket);
  }
  const elapsed = now - bucket.lastRefill;
  if (elapsed > 0) {
    bucket.tokens = Math.min(
      RATE_BUCKET_CAPACITY,
      bucket.tokens + elapsed * RATE_REFILL_PER_MS,
    );
    bucket.lastRefill = now;
  }
  if (bucket.tokens < 1) {
    throw new QuotaExceededError('rate limit exceeded', 'rate');
  }
  bucket.tokens -= 1;
}

export function acquireRunSlot(
  tenantId: string,
  limit: number,
): () => void {
  const current = concurrentRuns.get(tenantId) ?? 0;
  if (current >= limit) {
    throw new QuotaExceededError(
      `concurrent run limit reached (${limit})`,
      'concurrency',
    );
  }
  concurrentRuns.set(tenantId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const cur = concurrentRuns.get(tenantId) ?? 1;
    const next = Math.max(0, cur - 1);
    if (next === 0) concurrentRuns.delete(tenantId);
    else concurrentRuns.set(tenantId, next);
  };
}

export async function assertTokenBudget(
  client: PoolClient,
  tenantId: string,
): Promise<{ quotaTokensPerDay: number; tokensUsedToday: number; runsConcurrent: number }> {
  const tenantRow = await client.query<{
    quota_tokens_per_day: string;
    quota_runs_concurrent: number;
  }>(
    `SELECT quota_tokens_per_day, quota_runs_concurrent
       FROM tenants WHERE id = $1`,
    [tenantId],
  );
  if ((tenantRow.rowCount ?? 0) === 0) {
    throw new Error('tenant not found');
  }
  const quotaTokensPerDay = Number(tenantRow.rows[0]!.quota_tokens_per_day);
  const runsConcurrent = Number(tenantRow.rows[0]!.quota_runs_concurrent);
  const usage = await client.query<{ tokens_used: string }>(
    `SELECT tokens_used FROM tenant_usage
      WHERE tenant_id = $1 AND day = CURRENT_DATE`,
    [tenantId],
  );
  const tokensUsedToday = usage.rows[0] ? Number(usage.rows[0].tokens_used) : 0;
  if (tokensUsedToday >= quotaTokensPerDay) {
    throw new QuotaExceededError('daily token budget exhausted', 'tokens');
  }
  return { quotaTokensPerDay, tokensUsedToday, runsConcurrent };
}

export async function recordTokenUsage(
  client: PoolClient,
  tenantId: string,
  tokens: number,
): Promise<void> {
  if (tokens <= 0) return;
  const now = Date.now();
  await client.query(
    `INSERT INTO tenant_usage (tenant_id, day, tokens_used, requests, updated_at)
     VALUES ($1, CURRENT_DATE, $2, 1, $3)
     ON CONFLICT (tenant_id, day) DO UPDATE SET
       tokens_used = tenant_usage.tokens_used + EXCLUDED.tokens_used,
       requests    = tenant_usage.requests + 1,
       updated_at  = EXCLUDED.updated_at`,
    [tenantId, tokens, now],
  );
}
