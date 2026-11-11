import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';

export const showroomRouter = Router();

// Public showroom is deliberately read-only. A record is eligible only after
// a human marks it verified and a non-empty license is recorded. Discovery
// observations alone never become customer-facing offers.
showroomRouter.get('/records', (req: Request, res: Response) => {
  const rawLimit = Number(req.query.limit ?? 24);
  const limit = Number.isInteger(rawLimit) ? Math.min(60, Math.max(1, rawLimit)) : 24;
  const rawOffset = Number(req.query.offset ?? 0);
  const offset = Number.isInteger(rawOffset) ? Math.max(0, rawOffset) : 0;
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined;
  const kinds = ['product', 'tool', 'api', 'model', 'dataset', 'service'];
  if (kind && !kinds.includes(kind)) {
    res.status(400).json({ error: { message: 'Invalid showroom record kind' } });
    return;
  }

  const where = `
    r.verification_status = 'verified'
    AND r.license IS NOT NULL AND length(trim(r.license)) > 0
    AND r.source_url LIKE 'https://%'
    AND s.enabled = 1
  `;
  const db = getDb();
  const totalRow = kind
    ? db.prepare(`SELECT COUNT(*) AS total FROM discovery_records r
        JOIN discovery_sources s ON s.id = r.source_id WHERE ${where} AND r.kind = ?`).get(kind) as { total: number }
    : db.prepare(`SELECT COUNT(*) AS total FROM discovery_records r
        JOIN discovery_sources s ON s.id = r.source_id WHERE ${where}`).get() as { total: number };
  const rows = kind
    ? db.prepare(`SELECT r.id, r.kind, r.name, r.description, r.source_url AS sourceUrl,
          r.license, r.language, r.tags_json AS tagsJson, r.schema_version AS schemaVersion,
          r.content_hash AS contentHash, s.name AS sourceName
        FROM discovery_records r JOIN discovery_sources s ON s.id = r.source_id
        WHERE ${where} AND r.kind = ?
        ORDER BY r.last_seen_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(kind, limit, offset)
    : db.prepare(`SELECT r.id, r.kind, r.name, r.description, r.source_url AS sourceUrl,
          r.license, r.language, r.tags_json AS tagsJson, r.schema_version AS schemaVersion,
          r.content_hash AS contentHash, s.name AS sourceName
        FROM discovery_records r JOIN discovery_sources s ON s.id = r.source_id
        WHERE ${where}
        ORDER BY r.last_seen_at DESC, r.id DESC LIMIT ? OFFSET ?`).all(limit, offset);

  res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
  res.setHeader('X-Robots-Tag', 'index, follow');
  res.json({ records: rows, page: { limit, offset, total: totalRow.total } });
});
