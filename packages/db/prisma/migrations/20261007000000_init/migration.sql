-- Note: the generated `CREATE SCHEMA IF NOT EXISTS "public"` was removed - the migrator role
-- intentionally has no CREATE privilege on the database (ADR 0004), and "public" always exists.

-- CreateEnum
CREATE TYPE "platform_role" AS ENUM ('master', 'none');

-- CreateEnum
CREATE TYPE "org_role" AS ENUM ('org_admin', 'member');

-- CreateEnum
CREATE TYPE "app_role" AS ENUM ('admin', 'operator', 'viewer');

-- CreateEnum
CREATE TYPE "organization_status" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('invited', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "app_platform" AS ENUM ('web', 'android', 'ios', 'flutter_webview');

-- CreateEnum
CREATE TYPE "firebase_integration_status" AS ENUM ('pending_verification', 'active', 'failing', 'revoked');

-- CreateEnum
CREATE TYPE "key_status" AS ENUM ('active', 'revoked');

-- CreateEnum
CREATE TYPE "device_status" AS ENUM ('active', 'invalid', 'opted_out');

-- CreateEnum
CREATE TYPE "campaign_tone" AS ENUM ('direto', 'elegante', 'divertido', 'urgente', 'premium', 'jovem');

-- CreateEnum
CREATE TYPE "audience_type" AS ENUM ('device', 'token_list', 'topic', 'condition');

-- CreateEnum
CREATE TYPE "notification_status" AS ENUM ('draft', 'queued', 'pending_approval', 'scheduled', 'sending', 'sent', 'partially_sent', 'failed', 'canceled');

-- CreateEnum
CREATE TYPE "delivery_attempt_status" AS ENUM ('sent', 'failed', 'retrying');

-- CreateEnum
CREATE TYPE "automation_run_status" AS ENUM ('scheduled', 'sent', 'skipped', 'canceled', 'failed');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('user', 'system', 'api_key');

-- CreateEnum
CREATE TYPE "ai_generation_status" AS ENUM ('succeeded', 'partial', 'failed');

-- CreateEnum
CREATE TYPE "one_time_token_purpose" AS ENUM ('invite', 'password_reset');

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "slug" VARCHAR(63) NOT NULL,
    "status" "organization_status" NOT NULL DEFAULT 'active',
    "plan" VARCHAR(40) NOT NULL DEFAULT 'standard',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255),
    "platform_role" "platform_role" NOT NULL DEFAULT 'none',
    "status" "user_status" NOT NULL DEFAULT 'invited',
    "mfa_secret_enc" BYTEA,
    "mfa_enabled_at" TIMESTAMPTZ(3),
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "password_changed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "organization_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "org_role" NOT NULL DEFAULT 'member',
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("organization_id","user_id")
);

-- CreateTable
CREATE TABLE "support_sessions" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "master_user_id" UUID NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "ended_at" TIMESTAMPTZ(3),

    CONSTRAINT "support_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "family_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "user_agent" VARCHAR(512),
    "ip" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "replaced_by_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "one_time_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "purpose" "one_time_token_purpose" NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(255) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apps" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "platform" "app_platform" NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Sao_Paulo',
    "allowed_redirect_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_deep_link_schemes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "utm_defaults" JSONB NOT NULL DEFAULT '{}',
    "content_limits" JSONB NOT NULL DEFAULT '{}',
    "quiet_hours" JSONB NOT NULL DEFAULT '{}',
    "frequency_caps" JSONB NOT NULL DEFAULT '{}',
    "allowed_events" TEXT[] DEFAULT ARRAY['screen_view', 'view_item', 'add_to_cart', 'session_start', 'first_open', 'initiate_checkout', 'purchase']::TEXT[],
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_members" (
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "app_role" NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "app_members_pkey" PRIMARY KEY ("app_id","user_id")
);

-- CreateTable
CREATE TABLE "firebase_integrations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "project_id" VARCHAR(100) NOT NULL,
    "client_email" VARCHAR(254) NOT NULL,
    "private_key_ciphertext" BYTEA NOT NULL,
    "dek_ciphertext" BYTEA NOT NULL,
    "key_id" VARCHAR(32) NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "status" "firebase_integration_status" NOT NULL DEFAULT 'pending_verification',
    "last_verified_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(64),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "firebase_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ingest_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "public_key" VARCHAR(80) NOT NULL,
    "allowed_origins" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "key_status" NOT NULL DEFAULT 'active',
    "last_event_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "ingest_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "server_keys" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "key_prefix" VARCHAR(32) NOT NULL,
    "key_hash" VARCHAR(128) NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_used_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),

    CONSTRAINT "server_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "external_user_id" VARCHAR(128),
    "fcm_token_ciphertext" BYTEA NOT NULL,
    "fcm_token_hash" VARCHAR(128) NOT NULL,
    "platform" "app_platform" NOT NULL,
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_source" VARCHAR(40) NOT NULL,
    "status" "device_status" NOT NULL DEFAULT 'active',
    "is_test_device" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "theme" VARCHAR(80) NOT NULL,
    "segment" VARCHAR(60) NOT NULL,
    "tone" "campaign_tone" NOT NULL,
    "offer" JSONB NOT NULL DEFAULT '{}',
    "redirect_url" VARCHAR(2048) NOT NULL,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "campaign_id" UUID,
    "automation_rule_id" UUID,
    "firebase_integration_id" UUID NOT NULL,
    "title" VARCHAR(65) NOT NULL,
    "body" VARCHAR(240) NOT NULL,
    "image_url" VARCHAR(2048),
    "redirect_url" VARCHAR(2048) NOT NULL,
    "tracked_url" VARCHAR(2048) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "audience_type" "audience_type" NOT NULL,
    "audience_ref" JSONB NOT NULL,
    "estimated_recipients" INTEGER NOT NULL DEFAULT 0,
    "status" "notification_status" NOT NULL DEFAULT 'draft',
    "scheduled_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "rejection_reason" VARCHAR(500),
    "idempotency_key" VARCHAR(128),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audience_lists" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "invalid_count" INTEGER NOT NULL DEFAULT 0,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audience_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audience_list_entries" (
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "audience_list_id" UUID NOT NULL,
    "fcm_token_ciphertext" BYTEA NOT NULL,
    "fcm_token_hash" VARCHAR(128) NOT NULL,

    CONSTRAINT "audience_list_entries_pkey" PRIMARY KEY ("audience_list_id","fcm_token_hash")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "total" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "invalid_tokens" INTEGER NOT NULL DEFAULT 0,
    "heartbeat_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempts" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "target" VARCHAR(1024) NOT NULL,
    "status" "delivery_attempt_status" NOT NULL,
    "fcm_message_id" VARCHAR(255),
    "error_code" VARCHAR(64),
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "ingest_key_id" UUID,
    "server_key_id" UUID,
    "client_event_id" UUID,
    "name" VARCHAR(64) NOT NULL,
    "external_user_id" VARCHAR(128),
    "device_id" UUID,
    "properties" JSONB NOT NULL DEFAULT '{}',
    "origin" VARCHAR(255),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "slug" VARCHAR(100) NOT NULL,
    "trigger_event" VARCHAR(64) NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "cancel_on_events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "firebase_integration_id" UUID NOT NULL,
    "title" VARCHAR(65) NOT NULL,
    "body" VARCHAR(240) NOT NULL,
    "redirect_url" VARCHAR(2048) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "test_mode" BOOLEAN NOT NULL DEFAULT true,
    "per_user_cooldown_hours" INTEGER NOT NULL DEFAULT 24,
    "created_by_id" UUID,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "rule_id" UUID NOT NULL,
    "event_id" UUID,
    "device_id" UUID NOT NULL,
    "status" "automation_run_status" NOT NULL DEFAULT 'scheduled',
    "skip_reason" VARCHAR(64),
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "executed_at" TIMESTAMPTZ(3),
    "job_id" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "app_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "user_id" UUID,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(80) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "ai_generation_status" NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "app_id" UUID,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" UUID,
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(64) NOT NULL,
    "target_id" VARCHAR(128),
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(512),
    "correlation_id" VARCHAR(64) NOT NULL,
    "changes" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "organization_members_user_id_idx" ON "organization_members"("user_id");

-- CreateIndex
CREATE INDEX "support_sessions_organization_id_expires_at_idx" ON "support_sessions"("organization_id", "expires_at");

-- CreateIndex
CREATE INDEX "support_sessions_master_user_id_idx" ON "support_sessions"("master_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_replaced_by_id_key" ON "refresh_tokens"("replaced_by_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE UNIQUE INDEX "one_time_tokens_token_hash_key" ON "one_time_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "one_time_tokens_user_id_purpose_idx" ON "one_time_tokens"("user_id", "purpose");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");

-- CreateIndex
CREATE INDEX "apps_organization_id_idx" ON "apps"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "apps_id_organization_id_key" ON "apps"("id", "organization_id");

-- CreateIndex
CREATE INDEX "app_members_organization_id_user_id_idx" ON "app_members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "firebase_integrations_organization_id_idx" ON "firebase_integrations"("organization_id");

-- CreateIndex
CREATE INDEX "firebase_integrations_app_id_status_idx" ON "firebase_integrations"("app_id", "status");

-- CreateIndex
CREATE INDEX "firebase_integrations_key_id_idx" ON "firebase_integrations"("key_id");

-- CreateIndex
CREATE UNIQUE INDEX "firebase_integrations_id_app_id_key" ON "firebase_integrations"("id", "app_id");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_keys_public_key_key" ON "ingest_keys"("public_key");

-- CreateIndex
CREATE INDEX "ingest_keys_organization_id_idx" ON "ingest_keys"("organization_id");

-- CreateIndex
CREATE INDEX "ingest_keys_app_id_status_idx" ON "ingest_keys"("app_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ingest_keys_id_app_id_key" ON "ingest_keys"("id", "app_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_keys_key_prefix_key" ON "server_keys"("key_prefix");

-- CreateIndex
CREATE INDEX "server_keys_organization_id_idx" ON "server_keys"("organization_id");

-- CreateIndex
CREATE INDEX "server_keys_app_id_idx" ON "server_keys"("app_id");

-- CreateIndex
CREATE UNIQUE INDEX "server_keys_id_app_id_key" ON "server_keys"("id", "app_id");

-- CreateIndex
CREATE INDEX "devices_organization_id_idx" ON "devices"("organization_id");

-- CreateIndex
CREATE INDEX "devices_app_id_external_user_id_idx" ON "devices"("app_id", "external_user_id");

-- CreateIndex
CREATE INDEX "devices_app_id_status_idx" ON "devices"("app_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "devices_app_id_fcm_token_hash_key" ON "devices"("app_id", "fcm_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "devices_id_app_id_key" ON "devices"("id", "app_id");

-- CreateIndex
CREATE INDEX "campaigns_organization_id_idx" ON "campaigns"("organization_id");

-- CreateIndex
CREATE INDEX "campaigns_app_id_created_at_idx" ON "campaigns"("app_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_id_app_id_key" ON "campaigns"("id", "app_id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_idx" ON "notifications"("organization_id");

-- CreateIndex
CREATE INDEX "notifications_app_id_status_created_at_idx" ON "notifications"("app_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "notifications_app_id_scheduled_at_idx" ON "notifications"("app_id", "scheduled_at");

-- CreateIndex
CREATE INDEX "notifications_campaign_id_idx" ON "notifications"("campaign_id");

-- CreateIndex
CREATE INDEX "notifications_automation_rule_id_idx" ON "notifications"("automation_rule_id");

-- CreateIndex
CREATE INDEX "notifications_firebase_integration_id_app_id_idx" ON "notifications"("firebase_integration_id", "app_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_id_app_id_key" ON "notifications"("id", "app_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_app_id_idempotency_key_key" ON "notifications"("app_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "audience_lists_organization_id_idx" ON "audience_lists"("organization_id");

-- CreateIndex
CREATE INDEX "audience_lists_app_id_created_at_idx" ON "audience_lists"("app_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audience_lists_id_app_id_key" ON "audience_lists"("id", "app_id");

-- CreateIndex
CREATE INDEX "audience_list_entries_audience_list_id_app_id_idx" ON "audience_list_entries"("audience_list_id", "app_id");

-- CreateIndex
CREATE INDEX "audience_list_entries_organization_id_idx" ON "audience_list_entries"("organization_id");

-- CreateIndex
CREATE INDEX "deliveries_organization_id_idx" ON "deliveries"("organization_id");

-- CreateIndex
CREATE INDEX "deliveries_notification_id_app_id_idx" ON "deliveries"("notification_id", "app_id");

-- CreateIndex
CREATE INDEX "deliveries_app_id_started_at_idx" ON "deliveries"("app_id", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_id_app_id_key" ON "deliveries"("id", "app_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_delivery_id_app_id_idx" ON "delivery_attempts"("delivery_id", "app_id");

-- CreateIndex
CREATE INDEX "delivery_attempts_delivery_id_target_idx" ON "delivery_attempts"("delivery_id", "target");

-- CreateIndex
CREATE INDEX "delivery_attempts_organization_id_created_at_idx" ON "delivery_attempts"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "events_organization_id_idx" ON "events"("organization_id");

-- CreateIndex
CREATE INDEX "events_app_id_received_at_idx" ON "events"("app_id", "received_at");

-- CreateIndex
CREATE INDEX "events_app_id_name_received_at_idx" ON "events"("app_id", "name", "received_at");

-- CreateIndex
CREATE INDEX "events_app_id_external_user_id_received_at_idx" ON "events"("app_id", "external_user_id", "received_at");

-- CreateIndex
CREATE INDEX "events_ingest_key_id_idx" ON "events"("ingest_key_id");

-- CreateIndex
CREATE INDEX "events_server_key_id_idx" ON "events"("server_key_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_app_id_client_event_id_key" ON "events"("app_id", "client_event_id");

-- CreateIndex
CREATE INDEX "automation_rules_organization_id_idx" ON "automation_rules"("organization_id");

-- CreateIndex
CREATE INDEX "automation_rules_app_id_trigger_event_enabled_idx" ON "automation_rules"("app_id", "trigger_event", "enabled");

-- CreateIndex
CREATE INDEX "automation_rules_firebase_integration_id_app_id_idx" ON "automation_rules"("firebase_integration_id", "app_id");

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_id_app_id_key" ON "automation_rules"("id", "app_id");

-- CreateIndex
CREATE INDEX "automation_runs_rule_id_app_id_scheduled_for_idx" ON "automation_runs"("rule_id", "app_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "automation_runs_device_id_app_id_executed_at_idx" ON "automation_runs"("device_id", "app_id", "executed_at");

-- CreateIndex
CREATE INDEX "automation_runs_organization_id_idx" ON "automation_runs"("organization_id");

-- CreateIndex
CREATE INDEX "automation_runs_app_id_status_scheduled_for_idx" ON "automation_runs"("app_id", "status", "scheduled_for");

-- CreateIndex
CREATE INDEX "ai_generations_organization_id_idx" ON "ai_generations"("organization_id");

-- CreateIndex
CREATE INDEX "ai_generations_app_id_created_at_idx" ON "ai_generations"("app_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generations_user_id_created_at_idx" ON "ai_generations"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generations_campaign_id_app_id_idx" ON "ai_generations"("campaign_id", "app_id");

-- CreateIndex
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_app_id_created_at_idx" ON "audit_logs"("app_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_target_type_target_id_idx" ON "audit_logs"("target_type", "target_id");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_sessions" ADD CONSTRAINT "support_sessions_master_user_id_fkey" FOREIGN KEY ("master_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apps" ADD CONSTRAINT "apps_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_members" ADD CONSTRAINT "app_members_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "app_members" ADD CONSTRAINT "app_members_organization_id_user_id_fkey" FOREIGN KEY ("organization_id", "user_id") REFERENCES "organization_members"("organization_id", "user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firebase_integrations" ADD CONSTRAINT "firebase_integrations_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ingest_keys" ADD CONSTRAINT "ingest_keys_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "server_keys" ADD CONSTRAINT "server_keys_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_firebase_integration_id_app_id_fkey" FOREIGN KEY ("firebase_integration_id", "app_id") REFERENCES "firebase_integrations"("id", "app_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_automation_rule_id_fkey" FOREIGN KEY ("automation_rule_id") REFERENCES "automation_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_lists" ADD CONSTRAINT "audience_lists_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audience_list_entries" ADD CONSTRAINT "audience_list_entries_audience_list_id_app_id_fkey" FOREIGN KEY ("audience_list_id", "app_id") REFERENCES "audience_lists"("id", "app_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_notification_id_app_id_fkey" FOREIGN KEY ("notification_id", "app_id") REFERENCES "notifications"("id", "app_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempts" ADD CONSTRAINT "delivery_attempts_delivery_id_app_id_fkey" FOREIGN KEY ("delivery_id", "app_id") REFERENCES "deliveries"("id", "app_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_ingest_key_id_fkey" FOREIGN KEY ("ingest_key_id") REFERENCES "ingest_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_server_key_id_fkey" FOREIGN KEY ("server_key_id") REFERENCES "server_keys"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_firebase_integration_id_app_id_fkey" FOREIGN KEY ("firebase_integration_id", "app_id") REFERENCES "firebase_integrations"("id", "app_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_rule_id_app_id_fkey" FOREIGN KEY ("rule_id", "app_id") REFERENCES "automation_rules"("id", "app_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_device_id_app_id_fkey" FOREIGN KEY ("device_id", "app_id") REFERENCES "devices"("id", "app_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_app_id_organization_id_fkey" FOREIGN KEY ("app_id", "organization_id") REFERENCES "apps"("id", "organization_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_campaign_id_app_id_fkey" FOREIGN KEY ("campaign_id", "app_id") REFERENCES "campaigns"("id", "app_id") ON DELETE RESTRICT ON UPDATE CASCADE;
