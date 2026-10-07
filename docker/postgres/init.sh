#!/bin/sh
# Local-only: creates the migrator (DDL) and app (DML) roles from env passwords.
# Production roles are provisioned with packages/db/sql/roles.sql through the secret manager.
set -eu

psql -v ON_ERROR_STOP=1 \
  -v migrator_password="$MIGRATOR_DB_PASSWORD" \
  -v app_password="$APP_DB_PASSWORD" \
  -v db_name="$POSTGRES_DB" \
  --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
CREATE ROLE notify_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE notify_app LOGIN PASSWORD :'app_password';
GRANT CONNECT ON DATABASE :"db_name" TO notify_migrator, notify_app;
GRANT USAGE, CREATE ON SCHEMA public TO notify_migrator;
GRANT USAGE ON SCHEMA public TO notify_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE notify_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO notify_app;
ALTER DEFAULT PRIVILEGES FOR ROLE notify_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO notify_app;
ALTER DEFAULT PRIVILEGES FOR ROLE notify_migrator IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO notify_app;
SQL
