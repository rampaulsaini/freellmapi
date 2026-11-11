import type { Db } from '../types.js';

// Shared public-source catalogue. This stores provenance and normalized records;
// it deliberately does not fetch arbitrary URLs or bypass source access controls.
export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovery_sources (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      homepage_url TEXT NOT NULL,
      adapter_status TEXT NOT NULL DEFAULT 'manual'
        CHECK (adapter_status IN ('manual', 'available', 'disabled')),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS discovery_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL REFERENCES discovery_sources(id) ON DELETE RESTRICT,
      external_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('product', 'tool', 'api', 'model', 'dataset', 'service')),
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      source_url TEXT NOT NULL,
      license TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      verification_status TEXT NOT NULL DEFAULT 'unverified'
        CHECK (verification_status IN ('unverified', 'reviewed', 'verified', 'rejected')),
      first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (source_id, external_id)
    );

    CREATE INDEX IF NOT EXISTS idx_discovery_records_kind_seen
      ON discovery_records(kind, last_seen_at DESC);
    CREATE INDEX IF NOT EXISTS idx_discovery_records_name
      ON discovery_records(name COLLATE NOCASE);
  `);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO discovery_sources (id, name, homepage_url, adapter_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, '2026-11-11T00:00:00.000Z', '2026-11-11T00:00:00.000Z')
  `);
  insert.run('github', 'GitHub', 'https://github.com', 'available');
  insert.run('google-ai', 'Google AI for Developers', 'https://ai.google.dev', 'manual');
  insert.run('nvidia-build', 'NVIDIA Build', 'https://build.nvidia.com', 'manual');
  insert.run('huggingface', 'Hugging Face', 'https://huggingface.co', 'manual');
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS discovery_records; DROP TABLE IF EXISTS discovery_sources;');
}
