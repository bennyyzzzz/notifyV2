-- Database roles (§8 "usuário da aplicação sem permissão de DDL").
-- Run once per environment as a superuser, AFTER replacing the passwords through your secret manager.
-- Never commit real passwords. psql variables are used so this file stays secret-free:
--   psql -v migrator_password="$MIGRATOR_PW" -v app_password="$APP_PW" -v db_name=notify -f roles.sql

\set ON_ERROR_STOP on

-- Owns the schema; used only by `prisma migrate deploy` in CI/CD.
CREATE ROLE notify_migrator LOGIN PASSWORD :'migrator_password';
-- Used by api and worker at runtime. No DDL, no ownership.
CREATE ROLE notify_app LOGIN PASSWORD :'app_password';

GRANT CONNECT ON DATABASE :"db_name" TO notify_migrator, notify_app;
GRANT USAGE, CREATE ON SCHEMA public TO notify_migrator;
GRANT USAGE ON SCHEMA public TO notify_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- Default privileges for every table the migrator creates from now on.
ALTER DEFAULT PRIVILEGES FOR ROLE notify_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notify_app;
ALTER DEFAULT PRIVILEGES FOR ROLE notify_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO notify_app;
ALTER DEFAULT PRIVILEGES FOR ROLE notify_migrator IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO notify_app;
