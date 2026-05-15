// First-boot admin seeder.
//
// Runs after migrations on container start. When OD_SEED_ADMIN_EMAIL +
// OD_SEED_ADMIN_PASSWORD are set and no user with that email exists,
// provisions:
//   - tenant (name = OD_SEED_TENANT_NAME or 'Default')
//   - default workspace under that tenant
//   - admin user with bcrypt(password) and role = 'owner'
//   - tenant_members + workspace_memberships rows
//
// Idempotent: subsequent boots see the user exists and exit silently.

import { withoutTenant } from '../db/pool.js';
import { createUser } from './sessions.js';

export async function seedAdminIfRequested(): Promise<void> {
  const email = (process.env.OD_SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.OD_SEED_ADMIN_PASSWORD ?? '';
  if (!email || !password) return;
  const exists = await withoutTenant(async (client) => {
    const res = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1`,
      [email],
    );
    return (res.rowCount ?? 0) > 0;
  });
  if (exists) {
    // eslint-disable-next-line no-console
    console.log(`[od] seed admin ${email} already present, skipping`);
    return;
  }
  await createUser({
    email,
    password,
    displayName: process.env.OD_SEED_ADMIN_DISPLAY_NAME ?? email,
    tenantName: process.env.OD_SEED_TENANT_NAME ?? 'Default',
    role: 'owner',
  });
  // eslint-disable-next-line no-console
  console.log(`[od] seeded admin user ${email}`);
}
