import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
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
      expect.objectContaining({ id: 'github', adapterStatus: 'available' }),
      expect.objectContaining({ id: 'google-ai', adapterStatus: 'manual' }),
      expect.objectContaining({ id: 'nvidia-build', adapterStatus: 'manual' }),
    ]));
  });

  it('ingests normalized records idempotently and never marks them verified', async () => {
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
    const second = await request(app, 'POST', '/api/discovery/records', record);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.record.id).toBe(first.body.record.id);
    expect(second.body.record.verificationStatus).toBe('unverified');

    const listed = await request(app, 'GET', '/api/discovery/records?kind=tool');
    expect(listed.body.records).toHaveLength(1);
    expect(listed.body.records[0].sourceUrl).toBe(record.sourceUrl);
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
