import type { Db } from '../types.js';

export function up(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS discovery_sync_state (
      source_id TEXT PRIMARY KEY REFERENCES discovery_sources(id) ON DELETE CASCADE,
      checkpoint_at TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    UPDATE discovery_sources
       SET adapter_status = 'available'
     WHERE id = 'github' AND enabled = 1;
  `);
}

export function down(db: Db): void {
  db.exec('DROP TABLE IF EXISTS discovery_sync_state;');
  db.prepare("UPDATE discovery_sources SET adapter_status = 'manual' WHERE id = 'github'").run();
}
