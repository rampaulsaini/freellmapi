import { getDb } from '../db/index.js';

export type TenantRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: TenantRole;
}

/**
 * Resolve a tenant only when the authenticated user has exactly one active
 * membership. Until an explicit workspace-selection contract is implemented,
 * multiple active memberships are ambiguous and must fail closed.
 */
export function resolveTenantContext(userId: number): TenantContext | null {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  const rows = getDb().prepare(`
    SELECT t.id AS tenant_id,
           t.name AS tenant_name,
           t.slug AS tenant_slug,
           tm.role AS role
      FROM tenant_memberships tm
      JOIN tenants t ON t.id = tm.tenant_id
     WHERE tm.user_id = ?
       AND t.status = 'active'
     ORDER BY tm.created_at_ms ASC, t.id ASC
     LIMIT 2
  `).all(userId) as Array<{
    tenant_id: string;
    tenant_name: string;
    tenant_slug: string;
    role: TenantRole;
  }>;

  // Never silently select the first workspace when membership is ambiguous.
  if (rows.length !== 1) return null;
  const row = rows[0]!;
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    role: row.role,
  };
}
