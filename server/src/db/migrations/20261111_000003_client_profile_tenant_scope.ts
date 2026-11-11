// Scope downstream client profiles to one active tenant.
// Existing profiles remain unassigned: ownership cannot be inferred safely.
import type { Db } from '../types.js';

export function up(db: Db): void {
  const columns = db.prepare('PRAGMA table_info(client_profiles)').all() as Array<{ name: string }>;
  if (!columns.some(column => column.name === 'tenant_id')) {
    db.exec(`ALTER TABLE client_profiles ADD COLUMN tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE;`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_client_profiles_tenant_id ON client_profiles(tenant_id, id);');
}

export function down(db: Db): void {
  db.exec('DROP INDEX IF EXISTS idx_client_profiles_tenant_id;');
  db.exec('ALTER TABLE client_profiles DROP COLUMN tenant_id;');
}
