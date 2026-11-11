import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';

export const discoveryRouter = Router();

const recordSchema = z.object({
  sourceId: z.string().trim().min(1).max(80),
  externalId: z.string().trim().min(1).max(300),
  kind: z.enum(['product', 'tool', 'api', 'model', 'dataset', 'service']),
  name: z.string().trim().min(1).max(240),
  description: z.string().max(4000).optional().default(''),
  sourceUrl: z.string().url().max(2048).refine(value => value.startsWith('https://'), 'Source URL must use HTTPS'),
  license: z.string().max(300).nullable().optional(),
  metadata: z.record(z.unknown()).optional().default({}),
}).strict();

// Read-only dashboard endpoints; all routes are mounted behind dashboard auth.
discoveryRouter.get('/sources', (_req: Request, res: Response) => {
  const rows = getDb().prepare(`
    SELECT id, name, homepage_url AS homepageUrl, adapter_status AS adapterStatus,
           enabled, updated_at AS updatedAt
      FROM discovery_sources ORDER BY name COLLATE NOCASE
  `).all();
  res.setHeader('Cache-Control', 'no-store');
  res.json({ sources: rows });
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

// Internal ingestion primitive. It accepts normalized records only; it never
// crawls a submitted URL. Provider adapters must enforce their own API/ToS rules.
discoveryRouter.post('/records', (req: Request, res: Response) => {
  const parsed = recordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }
  const item = parsed.data;
  const metadataJson = JSON.stringify(item.metadata);
  if (Buffer.byteLength(metadataJson, 'utf8') > 16 * 1024) {
    res.status(400).json({ error: { message: 'Metadata must be 16 KB or smaller' } });
    return;
  }
  const db = getDb();
  const source = db.prepare('SELECT id FROM discovery_sources WHERE id = ? AND enabled = 1').get(item.sourceId);
  if (!source) {
    res.status(400).json({ error: { message: 'Unknown or disabled discovery source' } });
    return;
  }
  db.prepare(`
    INSERT INTO discovery_records (
      source_id, external_id, kind, name, description, source_url, license, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, external_id) DO UPDATE SET
      kind = excluded.kind, name = excluded.name, description = excluded.description,
      source_url = excluded.source_url, license = excluded.license,
      metadata_json = excluded.metadata_json, last_seen_at = datetime('now')
  `).run(item.sourceId, item.externalId, item.kind, item.name, item.description,
    item.sourceUrl, item.license ?? null, metadataJson);
  const saved = db.prepare(`
    SELECT id, verification_status AS verificationStatus
      FROM discovery_records WHERE source_id = ? AND external_id = ?
  `).get(item.sourceId, item.externalId);
  res.status(201).json({ record: saved, createdOrUpdated: true });
});
