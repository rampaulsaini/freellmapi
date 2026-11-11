import { createHash } from 'node:crypto';

export const DISCOVERY_SCHEMA_VERSION = '1.0.0';

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function discoveryContentHash(input: {
  kind: string;
  name: string;
  description: string;
  sourceUrl: string;
  license: string | null;
  language: string;
  tags: string[];
  metadata: unknown;
}): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}
