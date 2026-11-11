import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { GitHubDiscoveryError, syncGitHubRepositories } from '../services/github-discovery.js';
import { DISCOVERY_SCHEMA_VERSION, discoveryContentHash } from '../services/discovery-contract.js';

export const discoveryRouter = Router();

// Canonicalize object keys so provider key-order differences do not look like
// material source changes and unnecessarily invalidate a human verification.
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const recordSchema = z.object({
  sourceId: z.string().trim().min(1).max(80),
  externalId: z.string().trim().min(1).max(300),
  kind: z.enum(['product', 'tool', 'api', 'model', 'dataset', 'service']),
  name: z.string().trim().min(1).max(240),
  description: z.string().max(4000).optional().default(''),
  sourceUrl: z.string().url().max(2048).refine(value => value.startsWith('https://'), 'Source URL must use HTTPS'),
  license: z.string().max(300).nullable().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
  language: z.string().trim().min(2).max(35).optional().default('und'),
  tags: z.array(z.string().trim().min(1).max(64)).max(30).optional().default([]),
  sourceUpdatedAt: z.string().datetime().nullable().optional(),
  evidenceRefs: z.array(z.string().trim().min(1).max(300)).max(20).optional().default([]),
}).strict();

// All discovery routes are mounted behind dashboard authentication.
discoveryRouter.get('/sources', (_req: Request, res: Response) => {
  const rows = getDb().prepare(`
    SELECT id, name, homepage_url AS homepageUrl, adapter_status AS adapterStatus,
           enabled, updated_at AS updatedAt
      FROM discovery_sources ORDER BY name COLLATE NOCASE
  `).all();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ sources: rows });
});

discoveryRouter.post('/github/sync', async (req: Request, res: Response) => {
  const parsed = z.object({ query: z.string().trim().min(1).max(180).optional() }).strict().safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: { message: 'Invalid GitHub search request' } });
    return;
  }
  try {
    const result = await syncGitHubRepositories(getDb(), { query: parsed.data.query });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ sourceId: 'github', result, limits: { maxPages: 3, perPage: 100, maxResults: 300 } });
  } catch (error) {
    if (error instanceof GitHubDiscoveryError) {
      if (error.retryAfter) res.setHeader('Retry-After', error.retryAfter);
      res.status(error.status).json({ error: { message: error.message } });
      return;
    }
    res.status(502).json({ error: { message: 'GitHub discovery sync failed' } });
  }
});

discoveryRouter.get('/records', (req: Request, res: Response) => {
  const rawLimit = Number(req.query.limit ?? 25);
  const limit = Number.isInteger(rawLimit) ? Math.min(100, Math.max(1, rawLimit)) : 25;
  const rawOffset = Number(req.query.offset ?? 0);
  const offset = Number.isInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  if (kind && !['product', 'tool', 'api', 'model', 'dataset', 'service'].includes(kind)) {
    res.status(400).json({ error: { message: 'Invalid discovery record kind' } });
    return;
  }
  const rows = kind
    ? getDb().prepare(`
        SELECT r.id, r.source_id AS sourceId, s.name AS sourceName,
               r.external_id AS externalId, r.kind, r.name, r.description,
               r.source_url AS sourceUrl, r.license, r.verification_status AS verificationStatus,
               r.schema_version AS schemaVersion, r.content_hash AS contentHash, r.language,
               r.tags_json AS tagsJson, r.source_updated_at AS sourceUpdatedAt,
               r.evidence_refs_json AS evidenceRefsJson, r.last_synced_at AS lastSyncedAt,
               r.first_seen_at AS firstSeenAt, r.last_seen_at AS lastSeenAt
          FROM discovery_records r JOIN discovery_sources s ON s.id = r.source_id
         WHERE r.kind = ? ORDER BY r.last_seen_at DESC, r.id DESC LIMIT ? OFFSET ?
      `).all(kind, limit, offset)
    : getDb().prepare(`
        SELECT r.id, r.source_id AS sourceId, s.name AS sourceName,
               r.external_id AS externalId, r.kind, r.name, r.description,
               r.source_url AS sourceUrl, r.license, r.verification_status AS verificationStatus,
               r.first_seen_at AS firstSeenAt, r.last_seen_at AS lastSeenAt
          FROM discovery_records r JOIN discovery_sources s ON s.id = r.source_id
         ORDER BY r.last_seen_at DESC, r.id DESC LIMIT ? OFFSET ?
      `).all(limit, offset);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ records: rows, page: { limit, offset } });
});

// Normalized ingestion remains available for other trusted provider adapters.
discoveryRouter.post('/records', (req: Request, res: Response) => {
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const item = parsed.data;
  const metadataJson = stableJson(item.metadata);
  const tagsJson = stableJson(item.tags);
  const evidenceRefsJson = stableJson(item.evidenceRefs);
  if (Buffer.byteLength(metadataJson, 'utf8') > 16 * 1024
    || Buffer.byteLength(tagsJson, 'utf8') > 4 * 1024
    || Buffer.byteLength(evidenceRefsJson, 'utf8') > 8 * 1024) {
    res.status(400).json({ error: { message: 'Metadata, tags, or evidence references exceed their size limits' } });
    return;
  }
  const contentHash = discoveryContentHash({
    kind: item.kind, name: item.name, description: item.description, sourceUrl: item.sourceUrl,
    license: item.license ?? null, language: item.language, tags: item.tags, metadata: item.metadata,
  });
  const db = getDb();
  const source = db.prepare('SELECT id FROM discovery_sources WHERE id = ? AND enabled = 1').get(item.sourceId);
  if (!source) {
    res.status(400).json({ error: { message: 'Unknown or disabled discovery source' } });
    return;
  }
  db.prepare(`
    INSERT INTO discovery_records (
      source_id, external_id, kind, name, description, source_url, license, metadata_json,
      schema_version, content_hash, language, tags_json, source_updated_at, evidence_refs_json, last_synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(source_id, external_id) DO UPDATE SET
      verification_status = CASE
        WHEN discovery_records.kind IS NOT excluded.kind
          OR discovery_records.name IS NOT excluded.name
          OR discovery_records.description IS NOT excluded.description
          OR discovery_records.source_url IS NOT excluded.source_url
          OR discovery_records.license IS NOT excluded.license
          OR discovery_records.metadata_json IS NOT excluded.metadata_json
          OR discovery_records.content_hash <> '' AND discovery_records.content_hash IS NOT excluded.content_hash
          OR discovery_records.language IS NOT excluded.language
          OR discovery_records.tags_json IS NOT excluded.tags_json
          OR discovery_records.evidence_refs_json IS NOT excluded.evidence_refs_json
        THEN 'unverified'
        ELSE discovery_records.verification_status
      END,
      kind = excluded.kind, name = excluded.name, description = excluded.description,
      source_url = excluded.source_url, license = excluded.license, metadata_json = excluded.metadata_json,
      schema_version = excluded.schema_version, content_hash = excluded.content_hash,
      language = excluded.language, tags_json = excluded.tags_json,
      source_updated_at = excluded.source_updated_at, evidence_refs_json = excluded.evidence_refs_json,
      last_synced_at = datetime('now'), last_seen_at = datetime('now')
  `).run(item.sourceId, item.externalId, item.kind, item.name, item.description,
    item.sourceUrl, item.license ?? null, metadataJson, DISCOVERY_SCHEMA_VERSION, contentHash,
    item.language, tagsJson, item.sourceUpdatedAt ?? null, evidenceRefsJson);
  const saved = db.prepare(`
    SELECT id, verification_status AS verificationStatus, schema_version AS schemaVersion,
           content_hash AS contentHash, language, tags_json AS tagsJson,
           source_updated_at AS sourceUpdatedAt, evidence_refs_json AS evidenceRefsJson
      FROM discovery_records WHERE source_id = ? AND external_id = ?
  `).get(item.sourceId, item.externalId);
  res.status(201).json({ record: saved, createdOrUpdated: true });
});
