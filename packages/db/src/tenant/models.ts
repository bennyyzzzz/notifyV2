/**
 * How each Prisma model is scoped. A test parses schema.prisma and fails if a model with
 * `organizationId`/`appId` is missing here, so new tables cannot silently skip isolation.
 */
export interface TenantModelConfig {
  /** Field holding the organization id (`id` for the Organization model itself). */
  orgField: 'organizationId' | 'id';
  /** Field holding the app id, when the model is app-scoped (`id` for App itself). */
  appField: 'appId' | 'id' | null;
  /** Rows may be created only under a system scope (e.g. organizations). */
  systemCreateOnly?: boolean;
}

export const TENANT_MODELS: Readonly<Record<string, TenantModelConfig>> = {
  Organization: { orgField: 'id', appField: null, systemCreateOnly: true },
  OrganizationMember: { orgField: 'organizationId', appField: null },
  SupportSession: { orgField: 'organizationId', appField: null },
  App: { orgField: 'organizationId', appField: 'id' },
  AppMember: { orgField: 'organizationId', appField: 'appId' },
  FirebaseIntegration: { orgField: 'organizationId', appField: 'appId' },
  IngestKey: { orgField: 'organizationId', appField: 'appId' },
  ServerKey: { orgField: 'organizationId', appField: 'appId' },
  Device: { orgField: 'organizationId', appField: 'appId' },
  Campaign: { orgField: 'organizationId', appField: 'appId' },
  Notification: { orgField: 'organizationId', appField: 'appId' },
  AudienceList: { orgField: 'organizationId', appField: 'appId' },
  AudienceListEntry: { orgField: 'organizationId', appField: 'appId' },
  Delivery: { orgField: 'organizationId', appField: 'appId' },
  DeliveryAttempt: { orgField: 'organizationId', appField: 'appId' },
  Event: { orgField: 'organizationId', appField: 'appId' },
  AutomationRule: { orgField: 'organizationId', appField: 'appId' },
  AutomationRun: { orgField: 'organizationId', appField: 'appId' },
  AiGeneration: { orgField: 'organizationId', appField: 'appId' },
  AuditLog: { orgField: 'organizationId', appField: 'appId' },
};

/**
 * Identity tables used before a tenant is known (login, refresh, invites). They have no
 * organization column; access goes through the identity service only.
 */
export const IDENTITY_MODELS: readonly string[] = ['User', 'RefreshToken', 'OneTimeToken', 'MfaRecoveryCode'];
