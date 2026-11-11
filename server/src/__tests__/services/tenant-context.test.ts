import { beforeAll, describe, expect, it } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { createUser } from '../../services/auth.js';
import { resolveTenantContext } from '../../services/tenant-context.js';

describe('resolveTenantContext', () => {
  let ownerId: number;
  let otherUserId: number;
  let suspendedOnlyUserId: number;

  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');

    ownerId = createUser('tenant-owner@example.test', 'strong-test-password').userId;
    otherUserId = createUser('tenant-other@example.test', 'strong-test-password').userId;
    suspendedOnlyUserId = createUser('tenant-suspended@example.test', 'strong-test-password').userId;

    // These tests construct explicit memberships below; remove the private
    // workspaces createUser provisions so each case controls its own fixture.
    getDb().prepare('DELETE FROM tenant_memberships WHERE user_id IN (?, ?, ?)')
      .run(ownerId, otherUserId, suspendedOnlyUserId);
    getDb().prepare('DELETE FROM tenants WHERE id IN (?, ?, ?)')
      .run(`local-owner-${ownerId}`, `local-owner-${otherUserId}`, `local-owner-${suspendedOnlyUserId}`);

    getDb().prepare(`
      INSERT INTO tenants (id, name, slug, status, created_at_ms)
      VALUES ('tenant-owner', 'Owner workspace', 'tenant-owner', 'active', 1),
             ('tenant-other', 'Other workspace', 'tenant-other', 'active', 1),
             ('tenant-suspended', 'Suspended workspace', 'tenant-suspended', 'suspended', 1)
    `).run();

    getDb().prepare(`
      INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at_ms)
      VALUES ('tenant-owner', ?, 'owner', 1),
             ('tenant-other', ?, 'admin', 1),
             ('tenant-suspended', ?, 'owner', 1)
    `).run(ownerId, otherUserId, suspendedOnlyUserId);
  });

  it('resolves the sole active membership for each authenticated user', () => {
    expect(resolveTenantContext(ownerId)).toEqual({
      tenantId: 'tenant-owner',
      tenantName: 'Owner workspace',
      tenantSlug: 'tenant-owner',
      role: 'owner',
    });
    expect(resolveTenantContext(otherUserId)).toEqual({
      tenantId: 'tenant-other',
      tenantName: 'Other workspace',
      tenantSlug: 'tenant-other',
      role: 'admin',
    });
  });

  it('does not infer a tenant for users without a membership', () => {
    const unassigned = createUser('tenant-unassigned@example.test', 'strong-test-password');
    getDb().prepare('DELETE FROM tenant_memberships WHERE user_id = ?').run(unassigned.userId);
    expect(resolveTenantContext(unassigned.userId)).toBeNull();
  });

  it('does not return suspended workspaces', () => {
    expect(resolveTenantContext(suspendedOnlyUserId)).toBeNull();
  });

  it('fails closed when a user has multiple active memberships', () => {
    getDb().prepare(`
      INSERT INTO tenants (id, name, slug, status, created_at_ms)
      VALUES ('tenant-owner-second', 'Second owner workspace', 'tenant-owner-second', 'active', 2)
    `).run();
    getDb().prepare(`
      INSERT INTO tenant_memberships (tenant_id, user_id, role, created_at_ms)
      VALUES ('tenant-owner-second', ?, 'admin', 2)
    `).run(ownerId);

    expect(resolveTenantContext(ownerId)).toBeNull();
  });

  it('rejects invalid user identifiers without querying another tenant', () => {
    expect(resolveTenantContext(0)).toBeNull();
    expect(resolveTenantContext(-1)).toBeNull();
    expect(resolveTenantContext(Number.NaN)).toBeNull();
    expect(resolveTenantContext(1.5)).toBeNull();
  });
});
