import { getDb } from '../db/index.js';

export type TenantRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TenantContext {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  role: TenantRole;
}

/**
 * Resolve the active tenant explicitly associated with an authenticated user.
 *
 * There is intentionally no "first tenant" or default-tenant fallback: an
 * authenticated user without an active membership must not gain access to
 * another workspace by inference.
 */
export function resolveTenantContext(userId: number): TenantContext | null {
  if (!Number.isSafeInteger(userId) || userId <= 0) return null;

  const row = getDb().prepare(`
    SELECT t.id AS tenant_id,
           t.name AS tenant_name,
           t.slug AS tenant_slug,
           tm.role AS role
      FROM tenant_memberships tm
      JOIN tenants t ON t.id = tm.tenant_id
     WHERE tm.user_id = ?
       AND t.status = 'active'
     ORDER BY tm.created_at_ms ASC, t.id ASC
     LIMIT 1
  `).get(userId) as {
    tenant_id: string;
    tenant_name: string;
    tenant_slug: string;
    role: TenantRole;
  } | undefined;

  if (!row) return null;
  return {
    tenantId: row.tenant_id,
    tenantName: row.tenant_name,
    tenantSlug: row.tenant_slug,
    role: row.role,
  };
}
