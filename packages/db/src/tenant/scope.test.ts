import { describe, expect, it } from 'vitest';
import { TenantContextMissingError, TenantScopeViolationError, currentScope, withSystemScope, withTenant, type DbScope } from './context.js';
import { applyTenantScope } from './scope.js';

const ORG_A = '0192a5c4-0000-7000-8000-00000000000a';
const ORG_B = '0192a5c4-0000-7000-8000-00000000000b';
const APP_A = '0192a5c4-0000-7000-8000-0000000000a1';
const APP_B = '0192a5c4-0000-7000-8000-0000000000b1';
const tenantA: DbScope = { kind: 'tenant', organizationId: ORG_A, appId: APP_A };
const orgOnlyA: DbScope = { kind: 'tenant', organizationId: ORG_A };

describe('applyTenantScope — fail closed', () => {
  it('throws without a context for tenant models', () => {
    expect(() => applyTenantScope('Notification', 'findMany', {}, undefined)).toThrow(TenantContextMissingError);
  });

  it('throws for models without configuration', () => {
    expect(() => applyTenantScope('Unknown', 'findMany', {}, tenantA)).toThrow(TenantScopeViolationError);
  });

  it('blocks raw queries outside a system scope', () => {
    expect(() => applyTenantScope(undefined, '$queryRaw', [], tenantA)).toThrow(TenantContextMissingError);
    expect(() => applyTenantScope(undefined, '$executeRawUnsafe', [], undefined)).toThrow(TenantContextMissingError);
    expect(applyTenantScope(undefined, '$queryRaw', ['SELECT 1'], { kind: 'system', reason: 'health check' })).toEqual(['SELECT 1']);
  });

  it('lets identity models and system scopes through untouched', () => {
    const args = { where: { email: 'a@b.com' } };
    expect(applyTenantScope('User', 'findUnique', args, undefined)).toBe(args);
    expect(applyTenantScope('Notification', 'findMany', args, { kind: 'system', reason: 'retention job' })).toBe(args);
  });
});

describe('applyTenantScope — reads and writes', () => {
  it('V1-02: injects organizationId and appId into where for reads', () => {
    expect(applyTenantScope('Notification', 'findUnique', { where: { id: 'n1' } }, tenantA)).toEqual({
      where: { id: 'n1', organizationId: ORG_A, appId: APP_A },
    });
    expect(applyTenantScope('Notification', 'findMany', undefined, orgOnlyA)).toEqual({ where: { organizationId: ORG_A } });
    expect(applyTenantScope('OrganizationMember', 'count', {}, tenantA)).toEqual({ where: { organizationId: ORG_A } });
  });

  it('uses id as the scoping field for Organization and App', () => {
    expect(applyTenantScope('Organization', 'findFirst', {}, tenantA)).toEqual({ where: { id: ORG_A } });
    expect(applyTenantScope('App', 'findMany', {}, tenantA)).toEqual({ where: { organizationId: ORG_A, id: APP_A } });
    expect(applyTenantScope('App', 'create', { data: { name: 'Loja' } }, tenantA)).toEqual({
      data: { name: 'Loja', organizationId: ORG_A },
    });
  });

  it('V1-02: rejects a where clause that targets another tenant', () => {
    expect(() =>
      applyTenantScope('Notification', 'findMany', { where: { appId: APP_B } }, tenantA),
    ).toThrow(TenantScopeViolationError);
    expect(() =>
      applyTenantScope('Notification', 'deleteMany', { where: { organizationId: { in: [ORG_A, ORG_B] } } }, tenantA),
    ).toThrow(TenantScopeViolationError);
    expect(() => applyTenantScope('Notification', 'findMany', { where: 'x' }, tenantA)).toThrow(TenantScopeViolationError);
  });

  it('accepts a where clause that repeats the current tenant', () => {
    expect(applyTenantScope('Campaign', 'findMany', { where: { appId: APP_A } }, tenantA)).toEqual({
      where: { appId: APP_A, organizationId: ORG_A },
    });
  });

  it('scopes update/delete by where and forbids moving records between tenants', () => {
    expect(applyTenantScope('AutomationRule', 'update', { where: { id: 'r1' }, data: { name: 'x' } }, tenantA)).toEqual({
      where: { id: 'r1', organizationId: ORG_A, appId: APP_A },
      data: { name: 'x' },
    });
    expect(() =>
      applyTenantScope('AutomationRule', 'update', { where: { id: 'r1' }, data: { appId: APP_B } }, tenantA),
    ).toThrow(/another tenant/);
    expect(() =>
      applyTenantScope('AutomationRule', 'updateMany', { where: {}, data: { organizationId: ORG_B } }, tenantA),
    ).toThrow(/another tenant/);
    expect(applyTenantScope('Device', 'delete', { where: { id: 'd1' } }, tenantA)).toEqual({
      where: { id: 'd1', organizationId: ORG_A, appId: APP_A },
    });
  });

  it('injects tenant fields on create and createMany, rejecting conflicts', () => {
    expect(applyTenantScope('Campaign', 'create', { data: { name: 'Black Friday' } }, tenantA)).toEqual({
      data: { name: 'Black Friday', organizationId: ORG_A, appId: APP_A },
    });
    expect(applyTenantScope('Event', 'createMany', { data: [{ name: 'a' }, { name: 'b', appId: APP_A }] }, tenantA)).toEqual({
      data: [
        { name: 'a', organizationId: ORG_A, appId: APP_A },
        { name: 'b', organizationId: ORG_A, appId: APP_A },
      ],
    });
    expect(() => applyTenantScope('Campaign', 'create', { data: { name: 'x', appId: APP_B } }, tenantA)).toThrow(/conflicts/);
  });

  it('rejects relation-style connects that would bypass scalar checks', () => {
    expect(() =>
      applyTenantScope('Campaign', 'create', { data: { name: 'x', app: { connect: { id: APP_B } } } }, tenantA),
    ).toThrow(/scalars/);
    expect(() =>
      applyTenantScope('Campaign', 'update', { where: { id: 'c' }, data: { organization: { connect: { id: ORG_B } } } }, tenantA),
    ).toThrow(/scalars/);
  });

  it('scopes upsert in where, create and update', () => {
    expect(
      applyTenantScope('Device', 'upsert', { where: { id: 'd' }, create: { platform: 'web' }, update: { platform: 'ios' } }, tenantA),
    ).toEqual({
      where: { id: 'd', organizationId: ORG_A, appId: APP_A },
      create: { platform: 'web', organizationId: ORG_A, appId: APP_A },
      update: { platform: 'ios' },
    });
    expect(() =>
      applyTenantScope('Device', 'upsert', { where: { id: 'd' }, create: {}, update: { appId: APP_B } }, tenantA),
    ).toThrow(TenantScopeViolationError);
  });

  it('only creates organizations under a system scope', () => {
    expect(() => applyTenantScope('Organization', 'create', { data: { name: 'x' } }, tenantA)).toThrow(/system scope/);
  });
});

describe('scope context helpers', () => {
  it('propagates through async calls and isolates concurrent contexts', async () => {
    const seen: (string | undefined)[] = [];
    await Promise.all([
      withTenant({ organizationId: ORG_A }, async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        const scope = currentScope();
        seen.push(scope?.kind === 'tenant' ? scope.organizationId : undefined);
      }),
      withTenant({ organizationId: ORG_B, appId: APP_B }, async () => {
        const scope = currentScope();
        seen.push(scope?.kind === 'tenant' ? scope.organizationId : undefined);
      }),
    ]);
    expect(seen.sort()).toEqual([ORG_A, ORG_B].sort());
    expect(currentScope()).toBeUndefined();
  });

  it('validates ids and system reasons', async () => {
    expect(() => withTenant({ organizationId: "x' OR 1=1" }, () => 1)).toThrow(TenantScopeViolationError);
    expect(() => withTenant({ organizationId: ORG_A, appId: 'nope' }, () => 1)).toThrow(TenantScopeViolationError);
    expect(() => withSystemScope(' ', () => 1)).toThrow(TenantScopeViolationError);
    await expect(withSystemScope('retention job', () => currentScope())).resolves.toEqual({ kind: 'system', reason: 'retention job' });
  });

  it('keeps the scope for lazy thenables resolved after fn returns (Prisma queries)', async () => {
    // Mimics a PrismaPromise: the work happens only when .then() is called.
    const lazyQuery: PromiseLike<DbScope | undefined> = {
      then: (onfulfilled, onrejected) => Promise.resolve(currentScope()).then(onfulfilled, onrejected),
    };
    await expect(withTenant({ organizationId: ORG_A }, () => lazyQuery)).resolves.toEqual({
      kind: 'tenant',
      organizationId: ORG_A,
    });
  });
});
