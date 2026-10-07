import { TenantContextMissingError, TenantScopeViolationError, type DbScope } from './context.js';
import { IDENTITY_MODELS, TENANT_MODELS, type TenantModelConfig } from './models.js';

type Args = Record<string, unknown>;

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);
const CREATE_OPERATIONS = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_DATA_OPERATIONS = new Set(['update', 'updateMany', 'updateManyAndReturn']);

/**
 * Rewrites Prisma operation args so they can only touch rows of the current tenant.
 * Pure function: unit-tested without a database.
 */
export function applyTenantScope(model: string | undefined, operation: string, args: unknown, scope: DbScope | undefined): unknown {
  if (model === undefined) {
    // Raw queries ($queryRaw, $executeRaw) are not model-bound; they require an explicit system scope.
    if (scope?.kind !== 'system') {
      throw new TenantContextMissingError('$raw', operation);
    }
    return args;
  }
  if (IDENTITY_MODELS.includes(model)) return args;

  const config = TENANT_MODELS[model];
  if (!config) {
    // Fail closed: unknown models are never queried without review.
    throw new TenantScopeViolationError(`Model ${model} has no tenant configuration`);
  }
  if (scope === undefined) throw new TenantContextMissingError(model, operation);
  if (scope.kind === 'system') return args;

  const scoped: Args = { ...((args ?? {}) as Args) };
  const fields = scopeFields(config, scope);

  if (CREATE_OPERATIONS.has(operation)) {
    if (config.systemCreateOnly) {
      throw new TenantScopeViolationError(`${model} can only be created under a system scope`);
    }
    scoped['data'] = Array.isArray(scoped['data'])
      ? scoped['data'].map((row: unknown) => scopeCreateData(model, row, fields))
      : scopeCreateData(model, scoped['data'], fields);
    return scoped;
  }

  if (WHERE_OPERATIONS.has(operation)) {
    scoped['where'] = mergeWhere(model, scoped['where'], fields);
  }
  if (UPDATE_DATA_OPERATIONS.has(operation)) {
    assertNoScopeChange(model, scoped['data'], fields);
  }
  if (operation === 'upsert') {
    scoped['create'] = scopeCreateData(model, scoped['create'], fields);
    assertNoScopeChange(model, scoped['update'], fields);
  }
  return scoped;
}

function scopeFields(config: TenantModelConfig, scope: { organizationId: string; appId?: string }): Record<string, string> {
  const fields: Record<string, string> = { [config.orgField]: scope.organizationId };
  if (config.appField !== null && scope.appId !== undefined) {
    fields[config.appField] = scope.appId;
  }
  return fields;
}

function asRecord(model: string, value: unknown, part: string): Args {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TenantScopeViolationError(`${model}: ${part} must be an object`);
  }
  return value as Args;
}

function mergeWhere(model: string, where: unknown, fields: Record<string, string>): Args {
  const merged: Args = { ...asRecord(model, where, 'where') };
  for (const [field, value] of Object.entries(fields)) {
    const existing = merged[field];
    if (existing !== undefined && existing !== value) {
      throw new TenantScopeViolationError(`${model}: where.${field} conflicts with the tenant context`);
    }
    merged[field] = value;
  }
  return merged;
}

function scopeCreateData(model: string, data: unknown, fields: Record<string, string>): Args {
  const row: Args = { ...asRecord(model, data, 'data') };
  rejectRelationStyleScope(model, row);
  for (const [field, value] of Object.entries(fields)) {
    // `id` on App is the record's own key, never injected on create.
    if (field === 'id') continue;
    const existing = row[field];
    if (existing !== undefined && existing !== value) {
      throw new TenantScopeViolationError(`${model}: data.${field} conflicts with the tenant context`);
    }
    row[field] = value;
  }
  return row;
}

function assertNoScopeChange(model: string, data: unknown, fields: Record<string, string>): void {
  const row = asRecord(model, data, 'data');
  rejectRelationStyleScope(model, row);
  for (const [field, value] of Object.entries(fields)) {
    if (row[field] !== undefined && row[field] !== value) {
      throw new TenantScopeViolationError(`${model}: data.${field} cannot move a record to another tenant`);
    }
  }
}

/** Repositories must pass scalar ids; `app: { connect }` would bypass the checks above. */
function rejectRelationStyleScope(model: string, row: Args): void {
  if ('organization' in row || 'app' in row) {
    throw new TenantScopeViolationError(`${model}: use organizationId/appId scalars, not relation connects`);
  }
}
