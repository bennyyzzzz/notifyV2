import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from './generated/prisma/client.js';
import { currentScope } from './tenant/context.js';
import { applyTenantScope } from './tenant/scope.js';

/**
 * Every query on a tenant model is scoped by the AsyncLocalStorage context set with
 * `withTenant()` / `withSystemScope()`. Without a context the query throws (§6.3 rule 6).
 */
export const tenantGuardExtension = Prisma.defineExtension({
  name: 'notify-tenant-guard',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        return query(applyTenantScope(model, operation, args, currentScope()) as typeof args);
      },
    },
    async $queryRaw({ args, query }) {
      return query(applyTenantScope(undefined, '$queryRaw', args, currentScope()) as typeof args);
    },
    async $executeRaw({ args, query }) {
      return query(applyTenantScope(undefined, '$executeRaw', args, currentScope()) as typeof args);
    },
    async $queryRawUnsafe({ args, query }) {
      return query(applyTenantScope(undefined, '$queryRawUnsafe', args, currentScope()) as typeof args);
    },
    async $executeRawUnsafe({ args, query }) {
      return query(applyTenantScope(undefined, '$executeRawUnsafe', args, currentScope()) as typeof args);
    },
  },
});

export interface CreateDbClientOptions {
  connectionString: string;
  /** Max pool size per process. */
  poolMax?: number;
}

export function createDbClient(options: CreateDbClientOptions) {
  const adapter = new PrismaPg({
    connectionString: options.connectionString,
    max: options.poolMax ?? 10,
    // Fail fast instead of piling up requests when the database is unreachable.
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });
  return new PrismaClient({ adapter }).$extends(tenantGuardExtension);
}

export type DbClient = ReturnType<typeof createDbClient>;
