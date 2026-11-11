// Migration: tenant identity foundation for customer workspaces.
// This is an additive SQLite migration. It does not enable public signup or
// change the existing single-owner dashboard authentication flow.

import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'suspended', 'closed')),
      created_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tenant_memberships (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'owner'
        CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
      created_at_ms INTEGER NOT NULL,
      PRIMARY KEY (tenant_id, user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user
      ON tenant_memberships(user_id);
  `);

  // Preserve access for existing local installs by assigning each existing
  // dashboard account its own private tenant. No account is made public.
  const users = db.prepare('SELECT id, email FROM users ORDER BY id').all() as Array<{
    id: number;
    email: string;
  }>;
  const insertTenant = db.prepare(`
    INSERT OR IGNORE INTO tenants (id, name, slug, status, created_at_ms)
    VALUES (?, ?, ?, 'active', ?)
  `);
  const insertMembership = db.prepare(`
    INSERT OR IGNORE INTO tenant_memberships (tenant_id, user_id, role, created_at_ms)
    VALUES (?, ?, 'owner', ?)
  `);
  const now = Date.now();

  for (const user of users) {
    const tenantId = `local-owner-${user.id}`;
    insertTenant.run(tenantId, user.email, tenantId, now);
    insertMembership.run(tenantId, user.id, now);
  }
}

export function down(db: Db): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_tenant_memberships_user;
    DROP TABLE IF EXISTS tenant_memberships;
    DROP TABLE IF EXISTS tenants;
  `);
}
