# BLAIQ — Coolify Deploy Guide

End-to-end deploy of BLAIQ (frontend + backend in single container) to Coolify.

Frontend = Next.js 16 static export served by daemon. Backend = Node.js Express daemon. Postgres 16 sidecar. Single domain.

---

## 1. Prerequisites

- Coolify v4+ instance with Docker Engine
- Domain pointing at Coolify server (e.g. `app.blaiq.ai`, `api.blaiq.ai`, or single `blaiq.ai`)
- GitHub repo connected to Coolify (or git access token)
- API keys: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (optional)

---

## 2. Generate Required Secrets

Run locally before creating Coolify app:

```bash
# 32-byte session secret
openssl rand -hex 32

# Strong Postgres password
openssl rand -base64 32 | tr -d '/+=' | cut -c1-32

# Admin password
openssl rand -base64 16
```

Save outputs — paste into Coolify env vars below.

---

## 3. Create Coolify Application

### 3a. New Resource → Docker Compose

1. **Project**: pick or create (e.g. "BLAIQ Production")
2. **Environment**: `production`
3. **Source**: Git repository
4. **Branch**: `main`
5. **Build Pack**: `Docker Compose`
6. **Compose file path**: `deploy/docker-compose.yml`
7. **Base directory**: leave blank (repo root)

### 3b. Domains

In **Application → Domains** tab:

- Frontend + API (single container): `https://app.blaiq.ai`
- Coolify auto-routes port `7456` → your domain via Traefik

If splitting:
- `APP_DOMAIN=app.blaiq.ai` (web SPA)
- `API_DOMAIN=api.blaiq.ai` (daemon API)

Both point to same container; daemon handles routing internally.

---

## 4. Environment Variables

In Coolify **Application → Environment Variables**, add:

### Required

```env
# Postgres
POSTGRES_USER=open_design
POSTGRES_PASSWORD=<paste output from step 2>
POSTGRES_DB=open_design
DATABASE_URL=postgres://open_design:<POSTGRES_PASSWORD>@postgres:5432/open_design

# Daemon
OD_SESSION_SECRET=<paste 32-byte hex from step 2>
OD_ALLOWED_ORIGINS=https://app.blaiq.ai
OD_PG_SSL=disable
OD_RUN_MIGRATIONS=1
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=1024

# Domains
APP_DOMAIN=app.blaiq.ai
API_DOMAIN=app.blaiq.ai
```

### Seed Admin (first deploy only — leave empty after)

```env
OD_SEED_ADMIN_EMAIL=admin@blaiq.ai
OD_SEED_ADMIN_PASSWORD=<paste from step 2>
OD_SEED_ADMIN_DISPLAY_NAME=BLAIQ Admin
OD_SEED_TENANT_NAME=BLAIQ
```

### LLM Keys

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
```

### Optional

```env
OD_SIGNUP_ENABLED=0          # 1 = allow public signup
OD_COOKIE_INSECURE=          # leave blank in prod (HTTPS only)
OPEN_DESIGN_PORT=7456
OPEN_DESIGN_MEM_LIMIT=2g
```

> Coolify auto-mounts `.env` from these vars into the container.

---

## 5. Persistent Volumes

Coolify reads volume defs from `docker-compose.yml`. Verify these mount paths:

| Volume | Mount | Purpose |
|--------|-------|---------|
| `open_design_pg` | `/var/lib/postgresql/data` | Postgres data |
| `open_design_data` | `/data` | Daemon runtime files |

In Coolify **Storages** tab: confirm both volumes show "Persistent" status.

---

## 6. Build Settings

Coolify auto-detects from `deploy/docker-compose.yml`. Confirm:

- **Dockerfile**: `deploy/Dockerfile`
- **Build context**: `..` (repo root)
- **Build target**: `runtime` (multi-stage)

Build time: ~6-10 min first run (pnpm install + daemon build + web build).

---

## 7. First Deploy

1. Click **Deploy** in Coolify
2. Watch logs in **Deployments** tab
3. Wait for healthcheck to pass (`/api/health` returns 200)
4. Open `https://app.blaiq.ai`
5. Login with seed admin credentials
6. **After first login**: remove `OD_SEED_*` env vars and redeploy (admin already exists, no point exposing creds)

---

## 8. Database Migrations

Migrations run automatically on container boot (`OD_RUN_MIGRATIONS=1`).

To run manually:

```bash
# SSH into Coolify host
docker exec -it open-design node /app/deploy/daemon/dist/migrate.js
```

To reset DB (DESTROYS DATA):

```bash
docker compose -f deploy/docker-compose.yml down -v
# Then redeploy via Coolify UI
```

---

## 9. Healthcheck + Monitoring

Coolify polls `/api/health` every 30s (configured in compose).

View logs:
```bash
# Via Coolify UI: Application → Logs tab
# Or SSH:
docker logs -f open-design
docker logs -f open-design-postgres
```

---

## 10. Updating Production

Push to `main` branch → Coolify auto-deploys (if webhook configured).

Manual redeploy:
1. Coolify UI → Application → **Redeploy**
2. Or trigger webhook: `curl -X POST <coolify-webhook-url>`

Zero-downtime: Coolify rolls new container alongside old, swaps when healthcheck passes.

---

## 11. SSL / TLS

Coolify handles automatically via Let's Encrypt + Traefik:

1. Add domain in **Domains** tab
2. Coolify provisions cert
3. Force HTTPS toggle: ON

Verify:
```bash
curl -I https://app.blaiq.ai/api/health
# Should return 200 + valid cert
```

---

## 12. Backups

### Postgres dump

```bash
docker exec open-design-postgres pg_dump -U open_design open_design > backup-$(date +%F).sql
```

Schedule via Coolify **Backups** tab (S3-compatible target).

### Volume snapshot

```bash
docker run --rm -v open_design_data:/data -v $(pwd):/backup alpine \
  tar czf /backup/od-data-$(date +%F).tar.gz /data
```

---

## 13. Common Issues

| Symptom | Fix |
|---------|-----|
| `OD_SESSION_SECRET required` | Set env var (32+ random bytes) |
| 502 Bad Gateway | Check healthcheck logs — daemon may not bind to `0.0.0.0:7456` |
| CORS errors in browser | `OD_ALLOWED_ORIGINS` must include your exact `https://` domain |
| Cookie not set on login | Disable `OD_COOKIE_INSECURE` in prod; ensure HTTPS |
| `DATABASE_URL` connection refused | Postgres healthcheck failing — check `POSTGRES_PASSWORD` matches `DATABASE_URL` |
| Admin login fails first deploy | Seed env vars missing or password contains shell-special chars (avoid `$`, `&`, `"`) |
| Build OOM | Increase Coolify build instance RAM, or set `NODE_OPTIONS=--max-old-space-size=512` |

---

## 14. Smoke Test Checklist

After deploy, verify:

- [ ] `https://app.blaiq.ai` loads BLAIQ shell (top + bottom nav visible)
- [ ] Login with admin creds succeeds → redirects to home
- [ ] Mission Builder sidebar visible on home
- [ ] Can step through Type → Name → Brand → Config → Launch
- [ ] "Launch Mission" creates project, navigates to chat
- [ ] Send test prompt → agent responds (streaming)
- [ ] Logout works
- [ ] Cookie cleared on logout

---

## 15. File Reference

```
deploy/
├── COOLIFY.md           # this file
├── README.md            # local docker compose docs
├── Dockerfile           # multi-stage build
├── docker-compose.yml   # postgres + daemon services
├── .env.example         # template (commit)
└── .env.production      # real secrets (gitignored)
```

---

## 16. Production Hardening Checklist

- [ ] `OD_SIGNUP_ENABLED=0` (no public signup)
- [ ] Seed admin env vars removed after first deploy
- [ ] `OD_COOKIE_INSECURE` unset (HTTPS-only cookies)
- [ ] `OD_ALLOWED_ORIGINS` strict (no wildcards)
- [ ] Postgres not exposed to public (no port mapping in compose)
- [ ] Backups scheduled
- [ ] Admin password rotated from seed value
- [ ] Coolify SSH access restricted (key-only)
- [ ] Resource limits set (`mem_limit`, `pids_limit`)
- [ ] Healthcheck passing for 24h+

---

_Last updated: 2026-05-19_
