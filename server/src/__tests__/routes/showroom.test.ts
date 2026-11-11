import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';

const realFetch = globalThis.fetch;

async function request(app: Express, path: string) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    const response = await realFetch(`http://127.0.0.1:${address.port}${path}`);
    return { status: response.status, body: await response.json() as any };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('public verified showroom', () => {
  let app: Express;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('is public read-only and exposes only verified records with a declared license', async () => {
    const insert = getDb().prepare(`
      INSERT INTO discovery_records (source_id, external_id, kind, name, description, source_url, license)
      VALUES ('github', ?, 'tool', ?, 'Reviewed catalogue entry', 'https://github.com/example/tool', ?)
    `);
    insert.run('verified-licensed', 'Verified Licensed Tool', 'MIT');
    insert.run('unverified-licensed', 'Not Yet Verified', 'MIT');
    insert.run('verified-no-license', 'No License', null);
    getDb().prepare(`
      UPDATE discovery_records SET verification_status = 'verified'
       WHERE external_id IN ('verified-licensed', 'verified-no-license')
    `).run();

    const result = await request(app, '/api/showroom/records');
    expect(result.status).toBe(200);
    expect(result.body.page.total).toBe(1);
    expect(result.body.records).toHaveLength(1);
    expect(result.body.records[0]).toMatchObject({
      name: 'Verified Licensed Tool',
      license: 'MIT',
      sourceUrl: 'https://github.com/example/tool',
    });
    expect(result.body.records[0].name).not.toBe('Not Yet Verified');
    expect(result.body.records[0].name).not.toBe('No License');
  });

  it('validates filters and bounds pagination', async () => {
    const invalid = await request(app, '/api/showroom/records?kind=unknown');
    expect(invalid.status).toBe(400);
    const bounded = await request(app, '/api/showroom/records?limit=999&offset=-5');
    expect(bounded.status).toBe(200);
    expect(bounded.body.page).toMatchObject({ limit: 60, offset: 0 });
  });
});
