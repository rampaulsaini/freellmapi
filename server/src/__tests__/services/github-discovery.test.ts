import { beforeEach, describe, expect, it } from 'vitest';
import { getDb, initDb } from '../../db/index.js';
import {
  GitHubDiscoveryError,
  GITHUB_DISCOVERY_LIMITS,
  syncGitHubRepositories,
} from '../../services/github-discovery.js';

describe('GitHub public repository discovery adapter', () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  it('normalizes public repository results and stores provenance in the catalogue', async () => {
    const calls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return new Response(JSON.stringify({
        total_count: 1,
        items: [{
          full_name: 'sample/public-tool',
          name: 'public-tool',
          description: 'A public tool',
          html_url: 'https://github.com/sample/public-tool',
          license: { spdx_id: 'MIT' },
          stargazers_count: 12,
          forks_count: 3,
          language: 'TypeScript',
          updated_at: '2026-11-11T00:00:00Z',
          archived: false,
          disabled: false,
        }],
      }), { status: 200, headers: { 'x-ratelimit-remaining': '48' } });
    }) as typeof fetch;

    const result = await syncGitHubRepositories(getDb(), {
      query: 'stars:>5',
      fetchImpl,
      now: () => new Date('2026-11-11T10:00:00.000Z'),
    });

    expect(result).toMatchObject({ fetched: 1, createdOrUpdated: 1, pages: 1, rateLimitRemaining: 48 });
    expect(calls).toHaveLength(1);
    expect(calls[0].origin + calls[0].pathname).toBe('https://api.github.com/search/repositories');
    expect(calls[0].searchParams.get('q')).toBe('stars:>5');
    expect(calls[0].searchParams.get('per_page')).toBe('100');
    const saved = getDb().prepare(`
      SELECT source_id AS sourceId, external_id AS externalId, kind, name,
             source_url AS sourceUrl, license, schema_version AS schemaVersion,
             content_hash AS contentHash, language, tags_json AS tagsJson,
             source_updated_at AS sourceUpdatedAt, evidence_refs_json AS evidenceRefsJson
        FROM discovery_records
    `).get();
    expect(saved).toEqual({
      sourceId: 'github',
      externalId: 'sample/public-tool',
      kind: 'tool',
      name: 'public-tool',
      sourceUrl: 'https://github.com/sample/public-tool',
      license: 'MIT',
      schemaVersion: '1.0.0',
      contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      language: 'TypeScript',
      tagsJson: '[]',
      sourceUpdatedAt: '2026-11-11T00:00:00Z',
      evidenceRefsJson: '[]',
    });

    getDb().prepare(`
      UPDATE discovery_records
         SET verification_status = 'verified', evidence_refs_json = '["review:human-check"]'
       WHERE source_id = 'github' AND external_id = 'sample/public-tool'
    `).run();
    await syncGitHubRepositories(getDb(), {
      query: 'stars:>5',
      fetchImpl,
      now: () => new Date('2026-11-11T10:05:00.000Z'),
    });
    const reviewed = getDb().prepare(`
      SELECT verification_status AS verificationStatus, evidence_refs_json AS evidenceRefsJson
        FROM discovery_records WHERE source_id = 'github' AND external_id = 'sample/public-tool'
    `).get();
    expect(reviewed).toEqual({
      verificationStatus: 'verified',
      evidenceRefsJson: '["review:human-check"]',
    });
  });

  it('uses a persisted checkpoint with a one-day overlap and bounded pagination', async () => {
    const calls: URL[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      return new Response(JSON.stringify({
        total_count: 350,
        items: Array.from({ length: 100 }, (_, i) => ({
          full_name: `sample/tool-${url.searchParams.get('page')}-${i}`,
          name: `tool-${i}`,
          html_url: `https://github.com/sample/tool-${url.searchParams.get('page')}-${i}`,
        })),
      }), { status: 200, headers: { 'x-ratelimit-remaining': '40' } });
    }) as typeof fetch;

    await syncGitHubRepositories(getDb(), { fetchImpl, now: () => new Date('2026-11-11T10:00:00.000Z') });
    const result = await syncGitHubRepositories(getDb(), { fetchImpl, now: () => new Date('2026-11-12T10:00:00.000Z') });

    expect(result.pages).toBe(3);
    expect(result.fetched).toBe(300);
    expect(calls.slice(3).map(url => url.searchParams.get('page'))).toEqual(['1', '2', '3']);
    expect(calls[3].searchParams.get('q')).toContain('pushed:>=2026-11-10');
    expect(GITHUB_DISCOVERY_LIMITS).toEqual({ perPage: 100, maxPages: 3, maxResults: 300 });
  });

  it('surfaces GitHub rate limits as retryable errors without advancing the checkpoint', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ message: 'rate limited' }), {
      status: 403,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1794400000' },
    })) as typeof fetch;

    await expect(syncGitHubRepositories(getDb(), { fetchImpl })).rejects.toMatchObject({
      name: 'GitHubDiscoveryError',
      status: 429,
      retryAfter: '1794400000',
    });
    expect(getDb().prepare('SELECT * FROM discovery_sync_state').all()).toHaveLength(0);
  });

  it('rejects invalid query input before making a network request', async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response('{}');
    }) as typeof fetch;
    await expect(syncGitHubRepositories(getDb(), { query: '   ', fetchImpl })).rejects.toBeInstanceOf(GitHubDiscoveryError);
    expect(called).toBe(false);
  });
});
