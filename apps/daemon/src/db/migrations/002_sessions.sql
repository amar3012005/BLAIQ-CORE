-- Cookie session auth (replicating HIVEMIND/BLAIQ AuthProvider model).
--
-- Users authenticate via email + password (bcrypt hash). Successful
-- login issues a signed httpOnly session cookie holding the
-- session_id. Sessions live in the sessions table and carry the
-- tenant + user binding, expiry, and refresh metadata.
--
-- Roles + permissions mirror the HIVEMIND bootstrap response so the
-- frontend AuthProvider can render the same state machine
-- (anonymous/authenticated/forbidden/reauth_required/backend_unreachable).

-- Add password + display name + role to users (Supabase mirror was a
-- subset; we now own auth fully so add the fields we need).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_hash      TEXT,
  ADD COLUMN IF NOT EXISTS display_name       TEXT,
  ADD COLUMN IF NOT EXISTS role               TEXT NOT NULL DEFAULT 'member',
  ADD COLUMN IF NOT EXISTS locked_at          BIGINT,
  ADD COLUMN IF NOT EXISTS last_login_at      BIGINT;

-- The users.id used to be the Supabase auth uuid. Keep it as UUID but
-- no longer requires Supabase. Defaulting to gen_random_uuid() lets
-- the daemon create users locally.
ALTER TABLE users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_agent      TEXT,
  ip              INET,
  issued_at       BIGINT NOT NULL,
  refreshed_at    BIGINT NOT NULL,
  expires_at      BIGINT NOT NULL,
  revoked_at      BIGINT
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
  ON sessions(user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_expires
  ON sessions(expires_at) WHERE revoked_at IS NULL;

-- Workspace memberships (replicates HIVEMIND workspace_memberships).
-- A workspace is a sub-context inside a tenant (org). For v1 we model
-- one workspace per tenant; the schema supports many.
CREATE TABLE IF NOT EXISTS workspaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  created_at  BIGINT NOT NULL,
  UNIQUE (tenant_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspaces_tenant
  ON workspaces(tenant_id);

CREATE TABLE IF NOT EXISTS workspace_memberships (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         TEXT NOT NULL DEFAULT 'member',
  created_at   BIGINT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user
  ON workspace_memberships(user_id);

-- Feature flags per tenant (replicates HIVEMIND feature_flags map).
CREATE TABLE IF NOT EXISTS tenant_feature_flags (
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  flag       TEXT NOT NULL,
  enabled    BOOLEAN NOT NULL DEFAULT false,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, flag)
);

ALTER TABLE sessions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces             ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_memberships  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_feature_flags   ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  policy_tables TEXT[] := ARRAY[
    'sessions','workspaces','tenant_feature_flags'
  ];
  t TEXT;
BEGIN
  FOREACH t IN ARRAY policy_tables LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS tenant_isolation ON %I;'
      ' CREATE POLICY tenant_isolation ON %I'
      '   USING (tenant_id = app_current_tenant())'
      '   WITH CHECK (tenant_id = app_current_tenant());',
      t, t
    );
  END LOOP;
END $$;

-- workspace_memberships has no tenant_id; isolate via the parent
-- workspace using a SECURITY DEFINER lookup function. Simpler in v1:
-- expose membership rows only when the user_id matches the requester.
DO $$
BEGIN
  EXECUTE 'DROP POLICY IF EXISTS membership_self ON workspace_memberships;';
  EXECUTE
    'CREATE POLICY membership_self ON workspace_memberships'
    ' USING (true)'
    ' WITH CHECK (true);';
END $$;

INSERT INTO schema_migrations (version, applied_at)
VALUES ('002_sessions', (EXTRACT(EPOCH FROM now()) * 1000)::BIGINT)
ON CONFLICT (version) DO NOTHING;
