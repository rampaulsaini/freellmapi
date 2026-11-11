import type { Db } from '../types.js';

// Versioned provenance envelope for normalized discovery records.
export function up(db: Db): void {
  db.exec(`
    ALTER TABLE discovery_records ADD COLUMN schema_version TEXT NOT NULL DEFAULT '1.0.0';
    ALTER TABLE discovery_records ADD COLUMN content_hash TEXT NOT NULL DEFAULT '';
    ALTER TABLE discovery_records ADD COLUMN language TEXT NOT NULL DEFAULT 'und';
    ALTER TABLE discovery_records ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE discovery_records ADD COLUMN source_updated_at TEXT;
    ALTER TABLE discovery_records ADD COLUMN evidence_refs_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE discovery_records ADD COLUMN last_synced_at TEXT NOT NULL DEFAULT (datetime('now'));
    CREATE INDEX IF NOT EXISTS idx_discovery_records_content_hash
      ON discovery_records(content_hash);
  `);
}

export function down(db: Db): void {
  db.exec(`
    DROP INDEX IF EXISTS idx_discovery_records_content_hash;
    ALTER TABLE discovery_records DROP COLUMN last_synced_at;
    ALTER TABLE discovery_records DROP COLUMN evidence_refs_json;
    ALTER TABLE discovery_records DROP COLUMN source_updated_at;
    ALTER TABLE discovery_records DROP COLUMN tags_json;
    ALTER TABLE discovery_records DROP COLUMN language;
    ALTER TABLE discovery_records DROP COLUMN content_hash;
    ALTER TABLE discovery_records DROP COLUMN schema_version;
  `);
}
