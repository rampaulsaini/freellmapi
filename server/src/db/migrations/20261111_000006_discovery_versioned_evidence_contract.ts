import type { Db } from '../types.js';

// Versioned provenance envelope for normalized discovery records.
export function up(db: Db): void {
  // Some boot paths intentionally replay baseline migrations over an existing
  // database. Keep this migration safe when one or more envelope columns exist.
  const existing = new Set(
    (db.prepare('PRAGMA table_info(discovery_records)').all() as Array<{ name: string }>).map(column => column.name),
  );
  const columns: Array<[string, string]> = [
    ['schema_version', "ALTER TABLE discovery_records ADD COLUMN schema_version TEXT NOT NULL DEFAULT '1.0.0'"],
    ['content_hash', "ALTER TABLE discovery_records ADD COLUMN content_hash TEXT NOT NULL DEFAULT ''"],
    ['language', "ALTER TABLE discovery_records ADD COLUMN language TEXT NOT NULL DEFAULT 'und'"],
    ['tags_json', "ALTER TABLE discovery_records ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]'"],
    ['source_updated_at', 'ALTER TABLE discovery_records ADD COLUMN source_updated_at TEXT'],
    ['evidence_refs_json', "ALTER TABLE discovery_records ADD COLUMN evidence_refs_json TEXT NOT NULL DEFAULT '[]'"],
    ['last_synced_at', "ALTER TABLE discovery_records ADD COLUMN last_synced_at TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, statement] of columns) {
    if (!existing.has(name)) db.exec(statement);
  }
  db.exec(`
    UPDATE discovery_records SET last_synced_at = last_seen_at WHERE last_synced_at = '';
    CREATE INDEX IF NOT EXISTS idx_discovery_records_content_hash
      ON discovery_records(content_hash);
  `);
}

export function down(db: Db): void {
  const existing = new Set(
    (db.prepare('PRAGMA table_info(discovery_records)').all() as Array<{ name: string }>).map(column => column.name),
  );
  db.exec('DROP INDEX IF EXISTS idx_discovery_records_content_hash;');
  for (const name of [
    'last_synced_at',
    'evidence_refs_json',
    'source_updated_at',
    'tags_json',
    'language',
    'content_hash',
    'schema_version',
  ]) {
    if (existing.has(name)) db.exec(`ALTER TABLE discovery_records DROP COLUMN ${name};`);
  }
}
