import { defineConfig } from 'prisma/config';

// Migrations run with a dedicated role (DDL), never with the application role.
// See docs/decisions/0004-database-roles-and-append-only-audit.md
const migrationUrl = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  ...(migrationUrl ? { datasource: { url: migrationUrl } } : {}),
});
