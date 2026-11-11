import type { Db } from '../db/types.js';

const API_URL = 'https://api.github.com/search/repositories';
const PER_PAGE = 100;
const MAX_PAGES = 3;
const MAX_RESULTS = PER_PAGE * MAX_PAGES;

export interface GitHubSyncResult {
  fetched: number;
  createdOrUpdated: number;
  pages: number;
  checkpoint: string;
  rateLimitRemaining: number | null;
}

export class GitHubDiscoveryError extends Error {
  readonly status: number;
  readonly retryAfter: string | null;
  constructor(status: number, message: string, retryAfter: string | null = null) {
    super(message);
    this.name = 'GitHubDiscoveryError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function isoDay(value: string): string {
  return value.slice(0, 10);
}

/**
 * Search public GitHub repositories only. The API host is fixed, pagination is
 * bounded, and every item is normalized before it reaches the catalogue.
 */
export async function syncGitHubRepositories(
  db: Db,
  options: {
    query?: string;
    fetchImpl?: typeof fetch;
    now?: () => Date;
  } = {},
): Promise<GitHubSyncResult> {
  const userQuery = (options.query ?? 'stars:>0').trim();
  if (!userQuery || userQuery.length > 180 || /[\r\n]/.test(userQuery)) {
    throw new GitHubDiscoveryError(400, 'Search query must be 1–180 characters');
  }

  const now = (options.now ?? (() => new Date()))();
  const startedAt = now.toISOString();
  const state = db.prepare(
    'SELECT checkpoint_at AS checkpointAt FROM discovery_sync_state WHERE source_id = ?'
  ).get('github') as { checkpointAt?: string } | undefined;
  // One-day overlap protects against GitHub search-index delay; upsert is
  // idempotent, so overlap cannot create duplicate catalogue rows.
  const since = state?.checkpointAt
    ? new Date(new Date(state.checkpointAt).getTime() - 24 * 60 * 60 * 1000).toISOString()
    : null;
  const q = [userQuery, since ? `pushed:>=${isoDay(since)}` : null].filter(Boolean).join(' ');
  const fetchImpl = options.fetchImpl ?? fetch;
  let fetched = 0;
  let pages = 0;
  let rateLimitRemaining: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(API_URL);
    url.searchParams.set('q', q);
    url.searchParams.set('sort', 'updated');
    url.searchParams.set('order', 'desc');
    url.searchParams.set('per_page', String(PER_PAGE));
    url.searchParams.set('page', String(page));

    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'FreeLLMAPI-Universal-Discovery',
      },
      signal: AbortSignal.timeout(12_000),
    });
    const remaining = response.headers.get('x-ratelimit-remaining');
    rateLimitRemaining = remaining !== null && /^\d+$/.test(remaining) ? Number(remaining) : null;

    if (response.status === 403 || response.status === 429) {
      const retryAfter = response.headers.get('retry-after')
        ?? response.headers.get('x-ratelimit-reset');
      throw new GitHubDiscoveryError(429, 'GitHub API rate limit reached; retry later', retryAfter);
    }
    if (!response.ok) {
      throw new GitHubDiscoveryError(502, `GitHub Search API returned HTTP ${response.status}`);
    }

    const payload = await response.json() as {
      items?: Array<{
        full_name?: string;
        name?: string;
        description?: string | null;
        html_url?: string;
        license?: { spdx_id?: string | null } | null;
        stargazers_count?: number;
        forks_count?: number;
        language?: string | null;
        updated_at?: string;
        archived?: boolean;
        disabled?: boolean;
      }>;
      total_count?: number;
    };
    if (!Array.isArray(payload.items)) {
      throw new GitHubDiscoveryError(502, 'GitHub Search API response was not a repository list');
    }

    pages += 1;
    const items = payload.items.slice(0, PER_PAGE);
    for (const repo of items) {
      const externalId = repo.full_name?.trim();
      const name = repo.name?.trim();
      const sourceUrl = repo.html_url;
      if (!externalId || !name || !sourceUrl?.startsWith('https://github.com/')) continue;
      const metadata = stableJson({
        stars: Number.isFinite(repo.stargazers_count) ? repo.stargazers_count : 0,
        forks: Number.isFinite(repo.forks_count) ? repo.forks_count : 0,
        language: repo.language ?? null,
        updatedAt: repo.updated_at ?? null,
        archived: repo.archived === true,
        disabled: repo.disabled === true,
      });
      db.prepare(`
        INSERT INTO discovery_records (
          source_id, external_id, kind, name, description, source_url, license, metadata_json
        ) VALUES ('github', ?, 'tool', ?, ?, ?, ?, ?)
        ON CONFLICT(source_id, external_id) DO UPDATE SET
          verification_status = CASE
            WHEN discovery_records.kind IS NOT excluded.kind
              OR discovery_records.name IS NOT excluded.name
              OR discovery_records.description IS NOT excluded.description
              OR discovery_records.source_url IS NOT excluded.source_url
              OR discovery_records.license IS NOT excluded.license
              OR discovery_records.metadata_json IS NOT excluded.metadata_json
            THEN 'unverified'
            ELSE discovery_records.verification_status
          END,
          kind = excluded.kind, name = excluded.name, description = excluded.description,
          source_url = excluded.source_url, license = excluded.license,
          metadata_json = excluded.metadata_json, last_seen_at = datetime('now')
      `).run(
        externalId,
        name,
        repo.description ?? '',
        sourceUrl,
        repo.license?.spdx_id ?? null,
        metadata,
      );
      fetched += 1;
    }

    if (items.length < PER_PAGE || fetched >= MAX_RESULTS || page * PER_PAGE >= (payload.total_count ?? 0)) break;
    if (rateLimitRemaining !== null && rateLimitRemaining <= 1) {
      throw new GitHubDiscoveryError(429, 'GitHub API rate limit nearly exhausted; sync stopped safely',
        response.headers.get('x-ratelimit-reset'));
    }
  }

  db.prepare(`
    INSERT INTO discovery_sync_state (source_id, checkpoint_at, updated_at)
    VALUES ('github', ?, datetime('now'))
    ON CONFLICT(source_id) DO UPDATE SET
      checkpoint_at = excluded.checkpoint_at, updated_at = datetime('now')
  `).run(startedAt);

  return { fetched, createdOrUpdated: fetched, pages, checkpoint: startedAt, rateLimitRemaining };
}

export const GITHUB_DISCOVERY_LIMITS = {
  perPage: PER_PAGE,
  maxPages: MAX_PAGES,
  maxResults: MAX_RESULTS,
} as const;
