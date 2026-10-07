-- Hand-written constraints Prisma cannot express. See docs/decisions/0004-database-roles-and-append-only-audit.md
-- Only CHECK constraints, functions and triggers live here: Prisma's diff does not manage them,
-- so future `migrate dev` runs will not try to drop them.

-- ------------- Data shape checks -------------

ALTER TABLE "users"
  ADD CONSTRAINT "users_email_lowercase_chk" CHECK ("email" = lower("email")),
  ADD CONSTRAINT "users_failed_login_count_chk" CHECK ("failed_login_count" >= 0);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_slug_format_chk" CHECK ("slug" ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$');

ALTER TABLE "support_sessions"
  ADD CONSTRAINT "support_sessions_max_duration_chk" CHECK ("expires_at" <= "started_at" + interval '60 minutes');

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_version_chk" CHECK ("version" >= 1),
  ADD CONSTRAINT "notifications_title_not_blank_chk" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "notifications_body_not_blank_chk" CHECK (length(btrim("body")) > 0),
  ADD CONSTRAINT "notifications_estimated_recipients_chk" CHECK ("estimated_recipients" >= 0),
  ADD CONSTRAINT "notifications_scheduled_has_date_chk" CHECK ("status" <> 'scheduled' OR "scheduled_at" IS NOT NULL);

ALTER TABLE "automation_rules"
  ADD CONSTRAINT "automation_rules_delay_chk" CHECK ("delay_minutes" BETWEEN 0 AND 10080),
  ADD CONSTRAINT "automation_rules_cooldown_chk" CHECK ("per_user_cooldown_hours" BETWEEN 0 AND 720);

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_counters_chk" CHECK (
    "total" >= 0 AND "succeeded" >= 0 AND "failed" >= 0 AND "invalid_tokens" >= 0
    AND "succeeded" + "failed" <= "total"
  );

ALTER TABLE "delivery_attempts"
  ADD CONSTRAINT "delivery_attempts_attempt_chk" CHECK ("attempt" BETWEEN 1 AND 10);

ALTER TABLE "ai_generations"
  ADD CONSTRAINT "ai_generations_usage_chk" CHECK ("input_tokens" >= 0 AND "output_tokens" >= 0 AND "cost_cents" >= 0);

-- ------------- Same-app references for optional FKs (sec. 6.3 rule 4, V1-03) -------------
-- Required relations already use composite (id, app_id) foreign keys. Optional ones cannot
-- (Prisma limitation), so these triggers give the same guarantee.

CREATE OR REPLACE FUNCTION notify_assert_same_app() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  ref_table text := TG_ARGV[0];
  ref_column text := TG_ARGV[1];
  ref_id uuid;
  found boolean;
BEGIN
  EXECUTE format('SELECT ($1).%I', ref_column) INTO ref_id USING NEW;
  IF ref_id IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND app_id = $2)', ref_table)
    INTO found USING ref_id, NEW.app_id;
  IF NOT found THEN
    RAISE EXCEPTION 'cross-app reference rejected: %.% -> %', TG_TABLE_NAME, ref_column, ref_table
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "notifications_campaign_same_app"
  BEFORE INSERT OR UPDATE OF "campaign_id", "app_id" ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION notify_assert_same_app('campaigns', 'campaign_id');

CREATE TRIGGER "notifications_automation_rule_same_app"
  BEFORE INSERT OR UPDATE OF "automation_rule_id", "app_id" ON "notifications"
  FOR EACH ROW EXECUTE FUNCTION notify_assert_same_app('automation_rules', 'automation_rule_id');

CREATE TRIGGER "events_ingest_key_same_app"
  BEFORE INSERT OR UPDATE OF "ingest_key_id", "app_id" ON "events"
  FOR EACH ROW EXECUTE FUNCTION notify_assert_same_app('ingest_keys', 'ingest_key_id');

CREATE TRIGGER "events_server_key_same_app"
  BEFORE INSERT OR UPDATE OF "server_key_id", "app_id" ON "events"
  FOR EACH ROW EXECUTE FUNCTION notify_assert_same_app('server_keys', 'server_key_id');

CREATE TRIGGER "events_device_same_app"
  BEFORE INSERT OR UPDATE OF "device_id", "app_id" ON "events"
  FOR EACH ROW EXECUTE FUNCTION notify_assert_same_app('devices', 'device_id');

-- ------------- One active Firebase integration per (app, project) (sec. 7.2) -------------

CREATE OR REPLACE FUNCTION notify_firebase_project_unique_active() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."revoked_at" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- Serialize concurrent inserts for the same (app, project).
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."app_id"::text || ':' || NEW."project_id", 0));
  IF EXISTS (
    SELECT 1 FROM "firebase_integrations"
    WHERE "app_id" = NEW."app_id" AND "project_id" = NEW."project_id"
      AND "revoked_at" IS NULL AND "id" <> NEW."id"
  ) THEN
    RAISE EXCEPTION 'firebase project already active for this app'
      USING ERRCODE = 'unique_violation', CONSTRAINT = 'firebase_integrations_app_project_active_key';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "firebase_integrations_project_unique_active"
  BEFORE INSERT OR UPDATE OF "project_id", "app_id", "revoked_at" ON "firebase_integrations"
  FOR EACH ROW EXECUTE FUNCTION notify_firebase_project_unique_active();

-- ------------- Append-only audit log (sec. 7.11) -------------
-- Defense in depth: the application role only has INSERT/SELECT (see packages/db/sql/roles.sql),
-- and this trigger blocks UPDATE for everyone and DELETE of records younger than the
-- 2-year retention floor (the retention job is the only legitimate deleter).

CREATE OR REPLACE FUNCTION notify_audit_logs_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' AND OLD."created_at" > now() - interval '2 years' THEN
    RAISE EXCEPTION 'audit_logs records are retained for 2 years' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION notify_audit_logs_append_only();

CREATE OR REPLACE FUNCTION notify_audit_logs_block_truncate() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs cannot be truncated' USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION notify_audit_logs_block_truncate();

-- Grants for the runtime role, when it exists (created by packages/db/sql/roles.sql).
-- Default privileges give it DML on new tables; the audit log is narrowed to INSERT/SELECT.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notify_app') THEN
    REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "audit_logs" FROM notify_app;
    GRANT SELECT, INSERT ON TABLE "audit_logs" TO notify_app;
    IF to_regclass('public._prisma_migrations') IS NOT NULL THEN
      REVOKE ALL ON TABLE "_prisma_migrations" FROM notify_app;
    END IF;
  END IF;
END
$$;
