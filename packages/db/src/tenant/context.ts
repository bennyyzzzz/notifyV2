import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  organizationId: string;
  /** When set, app-scoped models are also filtered by this app. */
  appId?: string;
}

export type DbScope =
  | { kind: 'tenant'; organizationId: string; appId?: string }
  | { kind: 'system'; reason: string };

const storage = new AsyncLocalStorage<DbScope>();

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantContextMissingError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant context required for ${model}.${operation}`);
    this.name = 'TenantContextMissingError';
  }
}

export class TenantScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantScopeViolationError';
  }
}

/**
 * Prisma queries are lazy: they run when `.then()` is called. Awaiting inside `storage.run`
 * guarantees that happens while the scope is active, even when `fn` returns the query unawaited.
 */
function runScoped<T>(scope: DbScope, fn: () => T | PromiseLike<T>): Promise<T> {
  return storage.run(scope, async () => await fn());
}

/** Runs `fn` with every tenant-model query scoped to `ctx`. */
export function withTenant<T>(ctx: TenantContext, fn: () => T | PromiseLike<T>): Promise<T> {
  if (!UUID_PATTERN.test(ctx.organizationId) || (ctx.appId !== undefined && !UUID_PATTERN.test(ctx.appId))) {
    throw new TenantScopeViolationError('Tenant context ids must be UUIDs');
  }
  const scope: DbScope = { kind: 'tenant', organizationId: ctx.organizationId };
  if (ctx.appId !== undefined) scope.appId = ctx.appId;
  return runScoped(scope, fn);
}

/**
 * Explicit escape hatch for cross-tenant work (platform admin, retention jobs, migrations of data).
 * The reason is mandatory so call sites are greppable and reviewable.
 */
export function withSystemScope<T>(reason: string, fn: () => T | PromiseLike<T>): Promise<T> {
  if (reason.trim().length < 5) {
    throw new TenantScopeViolationError('System scope requires a descriptive reason');
  }
  return runScoped({ kind: 'system', reason }, fn);
}

export function currentScope(): DbScope | undefined {
  return storage.getStore();
}
