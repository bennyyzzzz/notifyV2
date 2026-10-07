export { createDbClient, tenantGuardExtension, type DbClient, type CreateDbClientOptions } from './client.js';
export {
  withTenant,
  withSystemScope,
  currentScope,
  TenantContextMissingError,
  TenantScopeViolationError,
  type TenantContext,
  type DbScope,
} from './tenant/context.js';
export { applyTenantScope } from './tenant/scope.js';
export { TENANT_MODELS, IDENTITY_MODELS, type TenantModelConfig } from './tenant/models.js';
export { Prisma } from './generated/prisma/client.js';
export type * from './generated/prisma/models.js';
export * from './generated/prisma/enums.js';
