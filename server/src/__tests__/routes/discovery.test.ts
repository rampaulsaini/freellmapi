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
      expect.objectContaining({ id: 'github', adapterStatus: 'available' }),
      expect.objectContaining({ id: 'google-ai', adapterStatus: 'manual' }),
      expect.objectContaining({ id: 'nvidia-build', adapterStatus: 'manual' }),
    ]));
  });

  it('runs the GitHub sync through an authenticated, bounded API endpoint', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      total_count: 1,
      items: [{
        full_name: 'sample/api-tool',
        name: 'api-tool',
        description: 'Public API tool',
        html_url: 'https://github.com/sample/api-tool',
        stargazers_count: 8,
        forks_count: 2,
        language: 'TypeScript',
      }],
    }), { status: 200, headers: { 'x-ratelimit-remaining': '50' } })) as typeof fetch;

    const unauthenticated = await request(app, 'POST', '/api/discovery/github/sync', {}, false);
    expect(unauthenticated.status).toBe(401);

    const result = await request(app, 'POST', '/api/discovery/github/sync', { query: 'stars:>1' });
    expect(result.status).toBe(200);
    expect(result.body.result).toMatchObject({ fetched: 1, pages: 1, rateLimitRemaining: 50 });
    expect(result.body.limits).toEqual({ maxPages: 3, perPage: 100, maxResults: 300 });
    expect(getDb().prepare("SELECT external_id FROM discovery_records WHERE source_id = 'github'").get())
      .toEqual({ external_id: 'sample/api-tool' });
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
      metadata: { stars: 42, details: { license: 'MIT', language: 'TS' } },
    };
    const first = await request(app, 'POST', '/api/discovery/records', record);
    expect(first.status).toBe(201);
    expect(first.body.record.verificationStatus).toBe('unverified');

    // A fresh observation with identical data must preserve a human review.
    getDb().prepare(`
      UPDATE discovery_records SET verification_status = 'verified'
       WHERE source_id = ? AND external_id = ?
    `).run(record.sourceId, record.externalId);
    const reorderedMetadata = {
      ...record,
      metadata: { details: { language: 'TS', license: 'MIT' }, stars: 42 },
    };
    const unchanged = await request(app, 'POST', '/api/discovery/records', reorderedMetadata);
    expect(unchanged.status).toBe(201);
    expect(unchanged.body.record.id).toBe(first.body.record.id);
    expect(unchanged.body.record.verificationStatus).toBe('verified');

    // Any material source-data change invalidates the previous verification.
    const changed = await request(app, 'POST', '/api/discovery/records', {
      ...record,
      name: 'Example Tool Updated',
      metadata: { stars: 43, details: { language: 'TS', license: 'MIT' } },
    });
    expect(changed.status).toBe(201);
    expect(changed.body.record.id).toBe(first.body.record.id);
    expect(changed.body.record.verificationStatus).toBe('unverified');

    const listed = await request(app, 'GET', '/api/discovery/records?kind=tool');
    expect(listed.body.records).toHaveLength(1);
    expect(listed.body.records[0].name).toBe('Example Tool Updated');
    expect(listed.body.records[0].schemaVersion).toBe('1.0.0');
    expect(listed.body.records[0].contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(listed.body.records[0].language).toBe('und');
    expect(listed.body.records[0].tagsJson).toBe('[]');
    expect(listed.body.records[0].evidenceRefsJson).toBe('[]');
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
  it('publishes only verified, licensed HTTPS records to the isolated Supabase showroom', async () => {
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-only-key';
    getDb().prepare(`
      INSERT INTO discovery_records (source_id, external_id, kind, name, description, source_url, license, verification_status)
      VALUES
        ('github', 'publish-me', 'tool', 'Verified Tool', 'Safe public description', 'https://github.com/example/tool', 'MIT', 'verified'),
        ('github', 'not-verified', 'tool', 'Unverified Tool', 'Do not publish', 'https://github.com/example/other', 'MIT', 'unverified'),
        ('github', 'no-license', 'tool', 'No License Tool', 'Do not publish', 'https://github.com/example/no-license', NULL, 'verified')
    `).run();

    const calls: Array<{ url: string; method: string; body: any }> = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? 'GET',
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(null, { status: 204 });
    }) as typeof fetch;

    const result = await request(app, 'POST', '/api/discovery/showroom/publish', {});
    expect(result.status).toBe(200);
    expect(result.body.result).toEqual({ eligible: 1, published: 1, batches: 1 });
    expect(calls[0].method).toBe('PATCH');
    expect(calls[1].method).toBe('POST');
    expect(calls[1].body).toHaveLength(1);
    expect(calls[1].body[0]).toMatchObject({
      external_id: 'publish-me',
      verification_status: 'verified',
      is_published: true,
      license: 'MIT',
    });
    expect(calls[1].body[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(calls[1].body[0].name).not.toBe('Unverified Tool');
    expect(calls[1].body[0].name).not.toBe('No License Tool');
  });

});
