import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { getDb, initDb } from '../../db/index.js';
import { mintDashboardToken, isGatedApiPath } from '../helpers/auth.js';

const realFetch = globalThis.fetch;
let token = '';

async function request(app: Express, method: string, path: string, body?: unknown, auth = true) {
  const server = app.listen(0, '127.0.0.1');
  if (!server.listening) await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address() as { port: number };
  try {
    const response = await realFetch(`http://127.0.0.1:${address.port}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(auth && isGatedApiPath(path) ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

describe('universal discovery catalogue foundation', () => {
  let app: Express;

  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
    app = createApp();
    token = mintDashboardToken();
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('requires dashboard authentication', async () => {
    const result = await request(app, 'GET', '/api/discovery/sources', undefined, false);
    expect(result.status).toBe(401);
  });

  it('seeds provider sources and marks non-connected adapters honestly', async () => {
    const result = await request(app, 'GET', '/api/discovery/sources');
    expect(result.status).toBe(200);
    expect(result.body.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'github', adapterStatus: 'manual' }),
      expect.objectContaining({ id: 'google-ai', adapterStatus: 'manual' }),
      expect.objectContaining({ id: 'nvidia-build', adapterStatus: 'manual' }),
    ]));
  });

  it('ingests normalized records idempotently and resets verification when source data changes', async () => {
    const record = {
      sourceId: 'github',
      externalId: 'owner/repo',
      kind: 'tool',
      name: 'Example Tool',
      description: 'Public repository metadata',
      sourceUrl: 'https://github.com/owner/repo',
      license: 'MIT',
      metadata: { stars: 42 },
    };
    const first = await request(app, 'POST', '/api/discovery/records', record);
    expect(first.status).toBe(201);
    expect(first.body.record.verificationStatus).toBe('unverified');

    // A fresh observation with identical data must preserve a human review.
    getDb().prepare(`
      UPDATE discovery_records SET verification_status = 'verified'
       WHERE source_id = ? AND external_id = ?
    `).run(record.sourceId, record.externalId);
    const unchanged = await request(app, 'POST', '/api/discovery/records', record);
    expect(unchanged.status).toBe(201);
    expect(unchanged.body.record.id).toBe(first.body.record.id);
    expect(unchanged.body.record.verificationStatus).toBe('verified');

    // Any material source-data change invalidates the previous verification.
    const changed = await request(app, 'POST', '/api/discovery/records', {
      ...record,
      name: 'Example Tool Updated',
      metadata: { stars: 43 },
    });
    expect(changed.status).toBe(201);
    expect(changed.body.record.id).toBe(first.body.record.id);
    expect(changed.body.record.verificationStatus).toBe('unverified');

    const listed = await request(app, 'GET', '/api/discovery/records?kind=tool');
    expect(listed.body.records).toHaveLength(1);
    expect(listed.body.records[0].name).toBe('Example Tool Updated');
  });

  it('rejects unknown sources and non-HTTPS source URLs', async () => {
    const base = {
      sourceId: 'unknown',
      externalId: 'x',
      kind: 'product',
      name: 'Unsafe',
      sourceUrl: 'https://example.com/item',
    };
    expect((await request(app, 'POST', '/api/discovery/records', base)).status).toBe(400);
    expect((await request(app, 'POST', '/api/discovery/records', {
      ...base, sourceId: 'github', sourceUrl: 'http://example.com/item',
    })).status).toBe(400);
  });
});
