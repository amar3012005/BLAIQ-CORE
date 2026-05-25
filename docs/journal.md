# BLAIQ White-Label Journal

Tracking white-labeling Open Design → BLAIQ. Cookie auth, Docker deploy, BLAIQ shell + Mission Builder wizard.

---

## Quick Commands

### Local dev (Docker stack)
```bash
# Start full stack (postgres + daemon + static web)
docker compose -f deploy/docker-compose.yml up --build -d

# Tail logs
docker compose -f deploy/docker-compose.yml logs -f open-design

# Stop
docker compose -f deploy/docker-compose.yml down

# Rebuild from scratch
docker compose -f deploy/docker-compose.yml down && \
  docker compose -f deploy/docker-compose.yml up --build -d
```

### App access
```
URL:      http://localhost:7456
Login:    admin@blaiq.ai / admin123
```

### Frontend build sanity check
```bash
pnpm --filter @open-design/web build
pnpm --filter @open-design/web typecheck
```

### Daemon build sanity check
```bash
pnpm --filter @open-design/daemon build
```

### Coolify deploy (target one.amar.blaiq.ai)
```bash
# Push branch, Coolify auto-pulls
git push origin main

# Or trigger via Coolify webhook
curl -X POST https://coolify.blaiq.ai/api/v1/deploy/<token>
```

### Reset DB (nuke everything)
```bash
docker compose -f deploy/docker-compose.yml down -v
docker compose -f deploy/docker-compose.yml up --build -d
```

---

## Stage-by-Stage Log

### S0 — Plan + scoping
Drafted multi-tenant SaaS plan: cookie auth, Postgres + RLS, single Docker container serves daemon API + static web, seed admin on boot.

### S1 — Postgres schema + RLS
- Wrote tenant model SQL migrations
- `app.tenant_id` GUC for row-level security
- Tables: `users`, `orgs`, `workspaces`, `org_members`, `projects`, `conversations`, `messages`, `runs`

### S2 — pg client + caller refactor (partial)
- Built async pg pool wrapper
- ~200 callsites in `server.ts` need migration (in progress)

### S3 — Cookie session auth (HIVEMIND-style)
- `apps/daemon/src/auth/sessions.ts` — bcrypt + signed httpOnly `od_session` cookie
- `apps/daemon/src/auth/cookie-middleware.ts` — `requireSession()` middleware
- `apps/daemon/src/auth/routes.ts` — POST `/api/v1/auth/{login,signup,refresh,logout}` + GET `/bootstrap`
- `apps/daemon/src/auth/seed-admin.ts` — idempotent admin seeder on boot
- Bootstrap returns user/org/roles/permissions/workspace_memberships/feature_flags

### S4 — Storage helper + fs tenant scoping (partial)
- Storage helper for tenant-scoped paths done
- ~30 `fs.*` callsites pending refactor

### S5 — Quota + sandbox
- `spawnEnvForTenantAgent` helper done
- Quota guard wired into `POST /api/chat` + `POST /api/runs`
- Sandbox CWD enforcement per tenant

### S6 — Docker compose + Dockerfile
- `deploy/docker-compose.yml` — postgres:16 + daemon, build context `..`
- `deploy/Dockerfile` — multi-stage: pnpm install → daemon build → web build → runtime with tini + agent CLIs
- `deploy/.env` (gitignored) — `POSTGRES_PASSWORD`, `OD_SESSION_SECRET`, `OD_COOKIE_INSECURE=1`, seed admin vars

### S7 — Frontend auth + ProtectedRoute
- `apps/web/src/auth/AuthProvider.tsx` — bootstrap fires once on mount (useRef guard)
- `apps/web/src/auth/LoginPage.tsx` — BLAIQ-styled login, uses `apiClient.login()` with `credentials: 'include'`
- `apps/web/src/auth/ProtectedRoute.tsx` — redirects to `/login` if not authenticated
- Public routes = `/login` + `/signup` only
- Wrapped `<ClientApp />` in `<ProtectedRoute><BlaiqShell>...</BlaiqShell></ProtectedRoute>`

### Fixes during build
- **Vercel: Chrome icon missing** — removed `Chrome` import from `lucide-react@1.14.0`, text only
- **Vercel: `.js` imports** — `moduleResolution: "bundler"` doesn't resolve `.js` → `.tsx`; stripped all `.js` extensions via sed
- **`useSearchParams` without Suspense** — wrapped `LoginPage` in `<Suspense>` in `app/login/page.tsx`
- **Docker 403 on `/composio/config`** — `requireLocalDaemonRequest` checks loopback IP; Docker bridge IP is 172.x not 127.x. Skip guard when `OD_SESSION_SECRET` set
- **Login redirect loop** — `/` was in `isPublicRoute` → AuthProvider set anonymous → ProtectedRoute redirected to `/login` → login redirected back. Removed `/` from public routes
- **SPA blink on navigation** — bootstrap re-ran on every pathname change. Fixed with `useRef` guard so bootstrap only runs once on mount

### BLAIQ Shell white-labeling
- `apps/web/src/auth/BlaiqShell.tsx` — pure inline-style workbench shell
  - **TopSystemBar** (44px): BLAIQ logo, Mission selector, search, Mode/Live indicator, Share, Users, Bell, Settings gear, Admin
  - **BottomGlobalNav** (46px): New Mission button, history, Home/Missions/Workflows/Swarm/Agents/Artifacts/Memory/Settings tabs
- Tailwind not in apps/web CSS pipeline → rewrote entire BlaiqShell with inline styles
- Changed `.app { height: 100vh }` → `height: 100%` in index.css so SPA fits inside BlaiqShell flex area
- Hid SPA's `AppChromeHeader` via `display: none !important` on `.app-chrome-header`

### MissionBuilder guided wizard
- `apps/web/src/auth/MissionBuilder.tsx` — 5-step guided creation flow
- Steps: **TYPE → NAME → BRAND → CONFIG → LAUNCH**
- Adapts step count per type: Media/Other = 3 steps, Prototype/Deck = 5 steps
- **Inline mode**: permanent left sidebar on home route (420px)
- Slide-in animation: `missionInlineSlide` 360ms cubic-bezier
- Step transition: `missionSlideForward` / `missionSlideBack` 200ms
- Auto-resolves `skillId` from type (no manual skill picker)
- Auto-advances after type selection (250ms delay)
- "Skip" button creates default prototype instantly
- Progress dots clickable to jump between completed steps
- Calls SPA's custom `navigate({ kind: 'project', projectId })` after `createProject()` (not Next.js router)

### BLAIQ home (Designs grid) theme overrides
Appended to `apps/web/src/index.css`:
- Entry tabs: monospace uppercase labels, orange accent on active
- Search input: warm neutral bg, sharp corners, orange focus
- Recent/Your designs toggles: dark fill when active
- Design cards: sharp corners, cream `#FAFAF7`, orange hover lift
- Tag pills (Prototype/Media/Slide): monospace uppercase with colored accents

### BLAIQ chat empty state theme overrides
Appended to `apps/web/src/index.css`:
- Background `#F1F0EC` matching login page
- "Start a conversation" title: Inter bold 26px ink
- Starter cards: dossier sharp corners, orange icon squares, accent hover border
- Tag pills: monospace orange
- Composer: cream bg, sharp corners
- Send button: solid orange
- Project view top action buttons: orange primary, outlined secondary

---

## Pending

- **S2** — finish `server.ts` async-pg caller refactor (~200 callsites, ~10h)
- **S4** — finish `fs.*` tenant path refactor (~30 callsites)
- **S5** — runs.ts integration of quota/sandbox helpers
- **S8** — Coolify deploy + smoke test at `one.amar.blaiq.ai`

---

## Key Files

### Auth + Shell
- `apps/web/src/auth/BlaiqShell.tsx`
- `apps/web/src/auth/MissionBuilder.tsx`
- `apps/web/src/auth/LoginPage.tsx`
- `apps/web/src/auth/AuthProvider.tsx`
- `apps/web/src/auth/ProtectedRoute.tsx`
- `apps/web/app/[[...slug]]/page.tsx`
- `apps/web/src/state/projects.ts`
- `apps/daemon/src/auth/sessions.ts`
- `apps/daemon/src/auth/cookie-middleware.ts`
- `apps/daemon/src/auth/routes.ts`
- `apps/daemon/src/auth/seed-admin.ts`

### Server
- `apps/daemon/src/server.ts` — auth route registration, SPA fallback, loopback guard bypass
- `apps/daemon/src/chat-routes.ts` — quota guard
- `apps/daemon/src/teams/team-store.js`
- `apps/daemon/src/memory/prisma-graph-store.js`

### Deploy
- `deploy/docker-compose.yml`
- `deploy/Dockerfile`
- `deploy/.env` (gitignored)

### Styles
- `apps/web/src/index.css` — BLAIQ theme overrides appended at bottom

---

## Architecture Sketch

```
Browser
  └─ apps/web (Next.js 16 static export)
       └─ BlaiqShell
            ├─ TopSystemBar
            ├─ MissionBuilder (home only, inline left sidebar)
            └─ {children} ← SPA (App.tsx)
                  ├─ EntryView (home grid)
                  ├─ ProjectView (chat + preview)
                  └─ ChatPane (empty state + composer)
            └─ BottomGlobalNav

apps/daemon (Express, Node 24)
  ├─ /api/v1/auth/* (cookie sessions)
  ├─ /api/projects (CRUD)
  ├─ /api/runs (agent spawn → SSE)
  ├─ /api/chat (streaming)
  └─ static: apps/web/out/ (SPA fallback)

Postgres 16
  ├─ Multi-tenant with RLS (app.tenant_id GUC)
  └─ Migrations on boot
```

---

_Last updated: 2026-05-17_
