# Multi-Tenant SaaS Production Deploy Plan

**Status:** In progress
**Started:** 2026-05-15
**Target:** Frontend on Vercel + Backend on Coolify with Docker Compose + Postgres + persistent multi-tenant data.

## Locked Decisions

| Area | Choice | Why |
|------|--------|-----|
| Auth | Supabase Auth (JWT) | Fastest secure path. Verify JWT server-side via JWKS. No password storage in our DB. |
| DB | Postgres 16 container in compose | Coolify-managed volume. Single source of truth. Migrate from SQLite. |
| File storage | Persistent volume `/data/tenants/<tenantId>/projects/<projectId>/` | Single-server bottleneck OK for v1. Migrate to S3/R2 later if needed. |
| API keys | Shared via env (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.) | Tenants never see/enter keys. Quota enforced per-tenant in app code. |
| Agent CLIs | Installed in Dockerfile, spawned as non-root user, CWD = tenant project dir | Isolation enforced in app code, not OS user. |
| Rate limiting | Per-tenant in-memory + DB-backed quotas (v1) | Token bucket. Per-day request + token budget. |
| Domains | `app.<DOMAIN>` (Vercel) + `api.<DOMAIN>` (Coolify) | Configurable via env. |

## Risk Register

1. **Tenant data leakage** — DB queries must always include `tenant_id` filter. Mitigation: row-level security (RLS) in Postgres + helper functions that require tenant context.
2. **Agent process leak** — child CLIs spawned by daemon must have CWD locked to tenant dir, with no env vars from other tenants. Mitigation: explicit env allowlist + chdir + path validation.
3. **Path traversal** — `projectId` and file paths from API requests must reject `..`, absolute paths, symlinks pointing outside tenant root.
4. **Shared API key abuse** — one tenant could exhaust budget. Mitigation: per-tenant token quota enforced at request entry, hard cutoff.
5. **CORS** — `OD_ALLOWED_ORIGINS` must be strict, no wildcard.
6. **SSE auth** — `/api/chat` streams must require JWT on connection.

## Stages

### S0 — Plan + Decisions (this doc)
Status: in progress.

### S1 — Postgres Schema + Tenant Model
- Add `tenants` table (id, owner_user_id, name, plan, quota_tokens_per_day, created_at).
- Add `users` table mirror (Supabase user_id, primary_tenant_id) — minimal local view for joins.
- Add `tenant_id` column (NOT NULL, FK) to: projects, conversations, messages, preview_comments, tabs, deployments, routines, routine_runs, templates, media_tasks, critique_*.
- Add Postgres-flavored migrations (`apps/daemon/src/db/migrations/*.sql`).
- Translate every SQLite-only construct: `INTEGER` timestamps → `BIGINT`, `ON CONFLICT ... DO UPDATE` is fine in PG, `PRAGMA` removed, `WAL` removed.
- Add indexes scoped by `(tenant_id, ...)`.
- Add Postgres row-level security policies as defense-in-depth (`USING (tenant_id = current_setting('app.tenant_id')::uuid)`).

### S2 — DB Layer Migration
- Replace `better-sqlite3` with `pg` (node-postgres) connection pool.
- Refactor `db.ts` exports: every function now takes `tenantId` as first param OR uses a `withTenant(tenantId, fn)` wrapper that sets `app.tenant_id` session var (for RLS).
- Replace synchronous `db.prepare(...).run()` calls with async `pool.query(...)`.
- Update all callers in daemon (server.ts, runs.ts, deploy-routes.ts, etc.) for async.
- Keep `openDatabase()` shape stable but return a pool wrapper.
- Test fixtures: spin up Postgres in test container.

### S3 — Auth Middleware
- New `apps/daemon/src/auth/` module.
- Express middleware verifies `Authorization: Bearer <JWT>` against Supabase JWKS.
- Attach `req.user = { userId, tenantId }` to request.
- Reject all `/api/*` routes without valid JWT (allowlist `/api/health`, `/api/public-config`).
- SSE endpoints (`/api/chat`) verify JWT on connection.
- WebSocket / EventSource: pass token as query param OR in cookie.

### S4 — File Storage Tenant Namespacing
- All file paths derive from `tenantId` + `projectId` joined to a fixed root.
- New helper: `resolveTenantPath(tenantId, projectId, relative)` validates no traversal.
- Update `home-expansion.ts`, `linked-dirs.ts`, every `fs.writeFile`/`fs.readFile` call.
- Default root: `${OD_DATA_DIR}/tenants/<tenantId>/projects/<projectId>/`.

### S5 — Agent Execution Sandbox + Quotas
- Modify `spawnEnvForAgent` and `applyAgentLaunchEnv` to inject shared API keys from env, never tenant-supplied.
- CWD always set to tenant project dir.
- Env vars allowlist (no passthrough of arbitrary env).
- Per-tenant concurrent run cap (e.g. 2 active agent runs per tenant).
- Token quota counter incremented on each LLM response (usage events).
- Quota exceeded → reject new runs with HTTP 429.

### S6 — Compose + Secrets
- Update `deploy/docker-compose.yml`:
  - `postgres:16-alpine` service with named volume.
  - `open-design` daemon service depends on postgres (healthcheck).
  - All secrets via `.env.production` (gitignored) or Coolify env UI.
  - Required env: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_JWKS_URL`, `OD_ALLOWED_ORIGINS`, `APP_DOMAIN`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OD_BIND_HOST=0.0.0.0`, `OD_PORT=7456`.
  - Daemon runs as non-root.
- Update `deploy/Dockerfile`:
  - Install `claude`, `codex`, etc. CLIs.
  - Add migration runner step (`pnpm --filter @open-design/daemon migrate`).

### S7 — Vercel Frontend
- `apps/web` already builds as static export (`output: 'export'`).
- Switch to server output for Vercel (`OD_WEB_OUTPUT_MODE=server` in Vercel env).
- Add `NEXT_PUBLIC_API_URL=https://api.<DOMAIN>` env.
- Update fetch helpers to use `NEXT_PUBLIC_API_URL` instead of relative paths.
- Wire Supabase JS client for auth (sign-in page + JWT in Authorization header).
- Add `vercel.json` if needed for headers / redirects.

### S8 — Deploy + Smoke Test
- Coolify: import compose, set env vars, deploy.
- Postgres migration runs on container start.
- Vercel: connect repo, point root to `apps/web`, set env vars.
- DNS: `api.<DOMAIN>` → Coolify, `app.<DOMAIN>` → Vercel.
- Smoke tests:
  1. Sign up new tenant via Supabase.
  2. Create project, send message, agent runs.
  3. Sign up second tenant, verify cannot see tenant A's projects (RLS test).
  4. Concurrent runs from two tenants.
  5. Quota exhaustion test.

## Out of Scope (v1)

- S3/R2 object storage (volume sufficient).
- Billing / Stripe integration.
- Admin dashboard.
- Per-tenant custom domains.
- Horizontal scaling (single daemon container; PG separate).
- Background job workers (agent runs synchronous-ish via SSE).
- Audit log (add later if compliance requires).

## Execution Order Within Each Stage

For every stage: red test first (where feasible), then implementation, then verify with package-scoped tests + `pnpm guard` + `pnpm typecheck`. Tenant isolation tests are mandatory for S2, S3, S4, S5.

## Resume Instructions

This plan spans multiple sessions. To resume:
1. Read this doc.
2. Check todos in conversation or re-create via TodoWrite.
3. Pick the first stage not marked complete in this doc's "Stages" section.
4. Each stage closes with: tests green, doc updated with status "complete", commit.

## Current Status

- [x] **S0 — Plan written** — this doc.
- [x] **S1 — Postgres schema** — `apps/daemon/src/db/migrations/001_initial.sql` translates every SQLite table to Postgres with `tenant_id` columns, FKs, indexes, RLS policies, and migration bookkeeping.
- [~] **S2 — DB layer migration** — Foundation landed:
  - `apps/daemon/src/db/pool.ts` — pg pool, `withTenant`, `withoutTenant`, `runMigrations`.
  - `apps/daemon/src/db/tenant-context.ts` — request-bound tenant propagation.
  - `apps/daemon/package.json` — added `pg`, `@types/pg`, `jose`.
  - **Remaining (next session):** rewrite `apps/daemon/src/db.ts` from sync better-sqlite3 to async pg. Every exported function becomes async and takes a `PoolClient` as first param. All callers in `server.ts`, `runs.ts`, `deploy-routes.ts`, `media-tasks.ts`, `critique/persistence.ts`, etc. become async. Tests under `apps/daemon/tests/` need a Postgres test container.
- [~] **S3 — Auth middleware** — Foundation landed:
  - `apps/daemon/src/auth/jwt-middleware.ts` — `requireAuth()` verifies Supabase JWT (JWKS or HS256), provisions a personal tenant on first sign-in, attaches `req.user` + `req.tenantId`.
  - **Remaining:** wire `app.use(requireAuth())` in `apps/daemon/src/server.ts` BEFORE any `/api` routes. Update SSE handlers in `claude-stream.ts`, `copilot-stream.ts`, etc. to read tenant from `req`. Add tests for token rejection and tenant provisioning.
- [~] **S4 — File storage** — Foundation landed:
  - `apps/daemon/src/storage/tenant-paths.ts` — `resolveTenantPath`, `projectRoot`, traversal guards.
  - **Remaining:** refactor every `fs.readFile` / `fs.writeFile` / `fs.mkdir` callsite in the daemon to route through `resolveTenantPath`. Most concentrated in `server.ts`, `home-expansion.ts`, `linked-dirs.ts`, `library-install.ts`, project file routes. Add a `pnpm guard` rule that flags `fs.*` calls outside this helper.
- [ ] **S5 — Agent sandbox + quotas** — Not started. Plan in S5 section above. Will require editing `agents.ts` (spawn env), adding a `tenant-quota.ts` middleware, and wiring into `runs.ts`.
- [x] **S6 — Compose + secrets** — `deploy/docker-compose.yml` now has Postgres + daemon services with strict env requirements. `deploy/.env.example` lists every required secret. Note: Dockerfile still needs migration runner step + agent CLI installs (S5 wiring).
- [ ] **S7 — Vercel frontend** — Not started. Plan in S7 section above.
- [ ] **S8 — Deploy + smoke test** — Not started.

## Resume Instructions (Next Session)

Read this doc top to bottom, then:

1. **S2 finish** — the biggest remaining item. Strategy:
   - Make `db.ts` exports async and accept `PoolClient` from `withTenant`.
   - Translate SQLite placeholders (`?`) to PG (`$1, $2, ...`).
   - Translate `Database.transaction` to manual `BEGIN`/`COMMIT` on the client.
   - Drop `PRAGMA` calls (PG enforces FKs by default).
   - Replace `INSERT OR REPLACE` with `ON CONFLICT ... DO UPDATE`.
   - For each function, add `tenantId` to the SQL (via RLS the session GUC handles it, but explicit filters in WHERE are defense-in-depth).
   - Tests: use `@testcontainers/postgresql` to spin up a real PG in tests.
2. **S3 wiring** — add `app.use(requireAuth())` in `server.ts` and verify every `/api` route reads `req.tenantId`. Allowlist: `/api/health`, `/api/public-config`.
3. **S4 refactor** — grep for `fs.readFile`, `fs.writeFile`, `fs.mkdir`, `fs.rm`, `path.join` with project paths. Route every persistent IO call through `resolveTenantPath`.
4. **S5** — modify `spawnEnvForAgent` to use only env-allowlisted vars + shared API keys. Add per-tenant concurrency cap in `runs.ts`. Add token quota counter incrementing on usage events.
5. **Dockerfile update** — install `claude`/`codex` CLIs, copy migrations to dist, add migration runner step on container start.
6. **S7 Vercel** — switch web to `OD_WEB_OUTPUT_MODE=server`, add `NEXT_PUBLIC_API_URL`, wire Supabase JS client for sign-in.
7. **S8** — deploy + smoke test (multi-tenant isolation is the critical test).

## Session 5 progress (2026-05-15 — patch + quota wiring)

Added:
- `apps/web/src/lib/install-fetch-patch.ts` — global `window.fetch` + `EventSource` monkeypatch. When `NEXT_PUBLIC_API_URL` is set: rewrites `/api/*`, `/artifacts/*`, `/frames/*` URLs to absolute and injects `credentials: 'include'` / `withCredentials: true`. Idempotent; no-op in single-origin dev. Avoids touching 17 fetch callsites across the web app.
- `apps/web/src/auth/AuthProvider.tsx` — invokes `installFetchPatch()` on module load (client-only guard).

Quota wiring:
- `apps/daemon/src/chat-routes.ts` — `/api/chat` and `/api/runs` now: lookup tenant limits, `acquireRunSlot()` before run, `release()` in `finally`. Activates only when `OD_SESSION_SECRET` is set (legacy single-user mode unaffected). 429 on quota breach.

## Session 4 progress (2026-05-15 — finalization pass)

Added:
- `apps/daemon/src/runtimes/env.ts` — new `spawnEnvForTenantAgent(agentId, tenantId, projectId, configuredEnv)` returning `{ env, cwd }`. Wraps `buildSandboxedSpawnEnv` then applies the existing claude-auth handling (strips ANTHROPIC_API_KEY unless ANTHROPIC_BASE_URL set). Existing `spawnEnvForAgent` kept for local-dev single-user mode.
- `apps/web/app/[[...slug]]/page.tsx` — wraps `<ClientApp />` in `<ProtectedRoute>` so the whole SPA requires a valid session.

## Concrete remaining caller refactor

Three big mechanical refactors block deploy. Each is a single grep + sed pattern repeated.

### 1. server.ts: sync sqlite → async pg + tenant scoping (~10h)

```bash
# Find all callsites
grep -n "from './db.js'\|from './media-tasks.js'\|from './critique/persistence.js'" apps/daemon/src/server.ts
```

For each route handler:

```ts
// BEFORE
app.get('/api/projects', (req, res) => {
  const projects = db.listProjects(getDb());
  res.json(projects);
});

// AFTER
import { runForTenant } from './db/tenant-context.js';
import * as db from './db-pg.js';

app.get('/api/projects', async (req, res) => {
  const projects = await runForTenant(req, (client) => db.listProjects(client));
  res.json(projects);
});
```

For inserts that need tenantId:

```ts
// AFTER
await runForTenant(req, (client) =>
  db.insertProject(client, req.tenantId, payload),
);
```

### 2. fs.* → resolveTenantPath (~3h)

```bash
grep -rn "fs\.\(readFile\|writeFile\|mkdir\|rm\|unlink\)\|path\.join.*\.od" apps/daemon/src/
```

Wrap every persistent IO call:

```ts
// BEFORE
const p = path.join(projectRoot, fileName);
await fs.writeFile(p, body);

// AFTER
import { resolveTenantPath } from './storage/tenant-paths.js';
const p = resolveTenantPath(req.tenantId, projectId, fileName);
await fs.writeFile(p, body);
```

### 3. runs.ts quota wiring (~2h)

In every endpoint that starts a chat/agent run:

```ts
import { acquireRunSlot, assertTokenBudget, recordTokenUsage, QuotaExceededError } from './auth/tenant-quota.js';

app.post('/api/chat', requireSession(), async (req, res) => {
  let release: () => void;
  try {
    const tenant = await runForTenant(req, (c) => assertTokenBudget(c, req.tenantId));
    release = acquireRunSlot(req.tenantId, tenant.runsConcurrent);
  } catch (e) {
    if (e instanceof QuotaExceededError) {
      return res.status(429).json({ detail: e.message, reason: e.reason });
    }
    throw e;
  }
  try {
    // existing run start, but use spawnEnvForTenantAgent(agentId, req.tenantId, projectId, cfgEnv)
    const { env, cwd } = spawnEnvForTenantAgent(agentId, req.tenantId, projectId, cfg);
    // on usage event:
    await runForTenant(req, (c) => recordTokenUsage(c, req.tenantId, tokens));
  } finally {
    release?.();
  }
});
```

### 4. Web fetch caller refactor (~2h)

```bash
grep -rn "fetch('/api/\|fetch(\"/api/" apps/web/src/
```

Replace each with `apiFetch(...)` from `src/lib/api-client.ts`. EventSource → `apiEventSource(path)`.

### 5. Smoke test + deploy (~3h)

1. `pnpm install`
2. `pnpm tools-dev` (verify local dev still works in single-user mode without OD_SESSION_SECRET set)
3. Set `OD_SESSION_SECRET`, `DATABASE_URL`, `OD_SIGNUP_ENABLED=1` locally; start Postgres; run migrations; create first admin via POST `/api/v1/auth/signup`.
4. Build image: `docker build -f deploy/Dockerfile -t open-design:test .`
5. Push image to docker hub or Coolify registry.
6. Provision Coolify project from compose, set env vars from `.env.production`.
7. DNS: `app.<domain>` → Vercel, `api.<domain>` → Coolify.
8. Tenant isolation smoke test (sign up tenant A + B, verify cross-tenant invisibility).
9. Quota smoke test.
10. Disable `OD_SIGNUP_ENABLED` after onboarding.

## Session 3 progress (2026-05-15 — auth pivot)

**Decision change:** dropped Supabase JWT. Replicated HIVEMIND/BLAIQ cookie-session auth verbatim.

Why: user wants identical auth flow to existing HIVEMIND/BLAIQ AuthProvider — state machine (loading/anonymous/authenticated/reauth_required/forbidden/backend_unreachable), `apiClient.bootstrap()`, `apiClient.login/logout/refresh`, workspace_memberships, feature_flags, permissions, dev fallback.

Added:
- `apps/daemon/src/db/migrations/002_sessions.sql` — `sessions`, `workspaces`, `workspace_memberships`, `tenant_feature_flags`; password_hash + display_name + role columns on users; RLS policies; `users.id` defaults to `gen_random_uuid()` (no longer Supabase-mirrored).
- `apps/daemon/src/auth/sessions.ts` — bcrypt password hashing, signed httpOnly cookie (`od_session=<id>.<HMAC>`), session rotation on refresh, rolling 7-day expiry, `buildBootstrap` returning HIVEMIND-shaped payload, `createUser` provisioning (tenant + workspace + membership + admin role).
- `apps/daemon/src/auth/cookie-middleware.ts` — `requireSession()`; allowlist for `/api/health`, `/api/public-config`, `/api/v1/auth/login`, `/api/v1/auth/signup`.
- `apps/daemon/src/auth/routes.ts` — POST /api/v1/auth/{login,signup,refresh,logout} + GET /bootstrap. Signup gated by `OD_SIGNUP_ENABLED=1`.
- `apps/daemon/src/server.ts` — registers auth routes + applies `requireSession()` when `OD_SESSION_SECRET` is set (legacy single-user mode unaffected).
- `apps/daemon/package.json` — added `bcryptjs` + `@types/bcryptjs`. Dropped `jose`.

Web (Next.js + TS port):
- `apps/web/src/shared/api-client.ts` — port of HIVEMIND `shared/api-client.js` (bootstrap/login/signup/refresh/logout/getLoginUrl, `HttpError`, `credentials: include`).
- `apps/web/src/auth/AuthProvider.tsx` — full TS port of HIVEMIND `AuthProvider.jsx`. Identical state machine, dev fallback, role permission helper.
- `apps/web/src/auth/ProtectedRoute.tsx` — Next.js port (uses `useRouter`, `usePathname` instead of react-router).
- `apps/web/src/auth/LoginPage.tsx` — full TS port of HIVEMIND `LoginPage.jsx` (same BLAIQ visual identity, email/password form wired to `apiClient.login`). Google + Phone tabs preserved but disabled with helpful error.
- `apps/web/app/layout.tsx` — wraps `<AuthProvider>` around children.
- `apps/web/app/login/page.tsx` — renders `<LoginPage />`.
- `apps/web/src/lib/api-client.ts` — rewritten to cookie auth (no token attach; `withCredentials: true` EventSource).
- Removed: `apps/web/src/lib/supabase-client.ts`, `apps/daemon/src/auth/jwt-middleware.ts`.

Compose + env updated to drop Supabase, add `OD_SESSION_SECRET`, `OD_COOKIE_INSECURE`, `OD_SIGNUP_ENABLED`.

**S3 = DONE.** Backend auth + frontend port complete and wired.

## Session 2 progress (2026-05-15 cont.)

Added:
- `apps/daemon/src/db-pg.ts` — full async pg port: projects, templates, conversations, messages, tabs, deployments, preview_comments, routines, routine_runs. Function names mirror db.ts so caller refactor is mechanical `await` + tenant wrap.
- `apps/daemon/src/media-tasks-pg.ts` — async pg port of media-tasks.ts.
- `apps/daemon/src/critique/persistence-pg.ts` — async pg port of critique persistence.
- `apps/daemon/src/auth/tenant-quota.ts` — rate (token bucket), concurrent run cap, daily token budget enforcement against `tenants` + `tenant_usage` rows.
- `apps/daemon/src/agents/sandboxed-spawn.ts` — `buildSandboxedSpawnEnv` returns a minimal env (PATH/HOME/NODE_ENV + shared LLM keys + allowlisted extras), with safe-env-key validation (blocks `LD_PRELOAD`, `DYLD_*`, `NODE_OPTIONS`).
- `apps/daemon/src/cli.ts` — boot-time `runMigrations()` when `OD_RUN_MIGRATIONS=1`.
- `deploy/Dockerfile` — installs `@anthropic-ai/claude-code` + `@openai/codex` CLIs, copies migrations into `dist/db/migrations/`, mounts `/data`, runs as non-root.
- `apps/web/src/lib/supabase-client.ts` — Supabase singleton with SSR-safe stub.
- `apps/web/src/lib/api-client.ts` — `apiFetch`, `apiJson`, `apiEventSourceUrl` with bearer-token attachment.
- `apps/web/vercel.json` — security headers + `OD_WEB_OUTPUT_MODE=server` build.
- `apps/web/.env.example` — Vercel env template.
- `apps/web/package.json` — added `@supabase/supabase-js`.

## Files Added in Session 1

- `apps/daemon/src/db/migrations/001_initial.sql`
- `apps/daemon/src/db/pool.ts`
- `apps/daemon/src/db/tenant-context.ts`
- `apps/daemon/src/auth/jwt-middleware.ts`
- `apps/daemon/src/storage/tenant-paths.ts`
- `deploy/docker-compose.yml` (rewritten)
- `deploy/.env.example` (rewritten)
- `apps/daemon/package.json` (added `pg`, `@types/pg`, `jose`)

## Files NOT Yet Touched (Need Edits Before Prod)

Caller refactor (mechanical but large):
- `apps/daemon/src/server.ts` — replace `import * as db from './db.js'` with `db-pg.js`. Wrap every handler in `runForTenant(req, async (client) => ...)`. Add `app.use(requireAuth())` before /api routes. ~4500 LOC, ~200 callsites.
- `apps/daemon/src/runs.ts` — wire quota: call `assertTokenBudget` + `acquireRunSlot` at run-start, `recordTokenUsage` on usage events, release slot on completion.
- `apps/daemon/src/agents.ts` — replace `spawnEnvForAgent` body with `buildSandboxedSpawnEnv` from `agents/sandboxed-spawn.ts`.
- All `fs.*` callsites under `apps/daemon/src/` — route through `resolveTenantPath`. Concentrated in: server.ts file routes, home-expansion.ts, linked-dirs.ts, library-install.ts, design-system-preview.ts.
- `apps/web/src/runtime/` callers — replace direct `fetch('/api/...')` with `apiFetch(...)` from `lib/api-client.ts`. Replace `new EventSource('/api/chat?...')` with `apiEventSourceUrl(...)`.
- `apps/web/app/` — add `/sign-in` page using `supabase.auth.signInWithOtp` (magic link). Add session guard wrapper.

