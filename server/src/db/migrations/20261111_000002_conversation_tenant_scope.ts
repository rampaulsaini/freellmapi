// Add tenant ownership to Playground conversations.
// Existing rows remain unassigned because their original user cannot be
// reliably inferred. They are retained but inaccessible through tenant-scoped
// routes until an explicit, verified ownership-recovery process exists.
import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    ALTER TABLE playground_conversations ADD COLUMN tenant_id TEXT
      REFERENCES tenants(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_playground_conversations_tenant_updated
      ON playground_conversations(tenant_id, updated_at_ms DESC, id DESC);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_playground_conversations_tenant_updated;
    ALTER TABLE playground_conversations DROP COLUMN tenant_id;
  `);
}
