/**
 * Domain enums. They mirror the native Postgres enums in `packages/db/prisma/schema.prisma`;
 * a test in `@notify/db` fails if the two drift apart (V1-15, V1-22).
 */

export const PLATFORM_ROLES = ['master', 'none'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

export const ORG_ROLES = ['org_admin', 'member'] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const APP_ROLES = ['admin', 'operator', 'viewer'] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ORGANIZATION_STATUSES = ['active', 'suspended'] as const;
export type OrganizationStatus = (typeof ORGANIZATION_STATUSES)[number];

export const USER_STATUSES = ['invited', 'active', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const APP_PLATFORMS = ['web', 'android', 'ios', 'flutter_webview'] as const;
export type AppPlatform = (typeof APP_PLATFORMS)[number];

export const FIREBASE_INTEGRATION_STATUSES = ['pending_verification', 'active', 'failing', 'revoked'] as const;
export type FirebaseIntegrationStatus = (typeof FIREBASE_INTEGRATION_STATUSES)[number];

export const KEY_STATUSES = ['active', 'revoked'] as const;
export type KeyStatus = (typeof KEY_STATUSES)[number];

export const DEVICE_STATUSES = ['active', 'invalid', 'opted_out'] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

export const CAMPAIGN_TONES = ['direto', 'elegante', 'divertido', 'urgente', 'premium', 'jovem'] as const;
export type CampaignTone = (typeof CAMPAIGN_TONES)[number];

export const AUDIENCE_TYPES = ['device', 'token_list', 'topic', 'condition'] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

export const NOTIFICATION_STATUSES = [
  'draft',
  'queued',
  'pending_approval',
  'scheduled',
  'sending',
  'sent',
  'partially_sent',
  'failed',
  'canceled',
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const DELIVERY_ATTEMPT_STATUSES = ['sent', 'failed', 'retrying'] as const;
export type DeliveryAttemptStatus = (typeof DELIVERY_ATTEMPT_STATUSES)[number];

export const AUTOMATION_RUN_STATUSES = ['scheduled', 'sent', 'skipped', 'canceled', 'failed'] as const;
export type AutomationRunStatus = (typeof AUTOMATION_RUN_STATUSES)[number];

export const ACTOR_TYPES = ['user', 'system', 'api_key'] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const AI_GENERATION_STATUSES = ['succeeded', 'partial', 'failed'] as const;
export type AiGenerationStatus = (typeof AI_GENERATION_STATUSES)[number];
