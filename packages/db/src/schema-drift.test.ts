import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as shared from '@notify/shared';
import { describe, expect, it } from 'vitest';
import { IDENTITY_MODELS, TENANT_MODELS } from './tenant/models.js';

const schema = readFileSync(fileURLToPath(new URL('../prisma/schema.prisma', import.meta.url)), 'utf8');

function blocks(kind: 'model' | 'enum'): Map<string, string[]> {
  const result = new Map<string, string[]>();
  const pattern = new RegExp(`^${kind} (\\w+) \\{([\\s\\S]*?)^\\}`, 'gm');
  for (const match of schema.matchAll(pattern)) {
    const lines = (match[2] ?? '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('@@') && !line.startsWith('///'));
    result.set(match[1]!, lines.map((line) => line.split(/\s+/)[0]!));
  }
  return result;
}

describe('schema drift guards', () => {
  const models = blocks('model');

  it('every model is classified as tenant or identity (fail closed)', () => {
    for (const name of models.keys()) {
      expect(TENANT_MODELS[name] !== undefined || IDENTITY_MODELS.includes(name), `model ${name} is unclassified`).toBe(true);
    }
  });

  it('every model with organizationId/appId uses those fields for scoping', () => {
    for (const [name, fields] of models) {
      const config = TENANT_MODELS[name];
      if (fields.includes('organizationId')) {
        expect(config?.orgField, `${name}.orgField`).toBe('organizationId');
      }
      if (fields.includes('appId')) {
        expect(config?.appField, `${name}.appField`).toBe('appId');
      }
    }
  });

  it('identity models carry no tenant columns', () => {
    for (const name of IDENTITY_MODELS) {
      const fields = models.get(name);
      expect(fields, name).toBeDefined();
      expect(fields).not.toContain('appId');
    }
  });

  it('V1-15/V1-22: Postgres enums match @notify/shared constants', () => {
    const enums = blocks('enum');
    const expected: Record<string, readonly string[]> = {
      PlatformRole: shared.PLATFORM_ROLES,
      OrgRole: shared.ORG_ROLES,
      AppRole: shared.APP_ROLES,
      OrganizationStatus: shared.ORGANIZATION_STATUSES,
      UserStatus: shared.USER_STATUSES,
      AppPlatform: shared.APP_PLATFORMS,
      FirebaseIntegrationStatus: shared.FIREBASE_INTEGRATION_STATUSES,
      KeyStatus: shared.KEY_STATUSES,
      DeviceStatus: shared.DEVICE_STATUSES,
      CampaignTone: shared.CAMPAIGN_TONES,
      AudienceType: shared.AUDIENCE_TYPES,
      NotificationStatus: shared.NOTIFICATION_STATUSES,
      DeliveryAttemptStatus: shared.DELIVERY_ATTEMPT_STATUSES,
      AutomationRunStatus: shared.AUTOMATION_RUN_STATUSES,
      ActorType: shared.ACTOR_TYPES,
      AiGenerationStatus: shared.AI_GENERATION_STATUSES,
    };
    for (const [name, values] of Object.entries(expected)) {
      expect(enums.get(name), name).toEqual([...values]);
    }
  });

  it('migrations are ASCII-only and never recreate the public schema', () => {
    const dir = fileURLToPath(new URL('../prisma/migrations/', import.meta.url));
    for (const entry of readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
      const sql = readFileSync(join(dir, entry.name, 'migration.sql'), 'utf8');
      // Non-UTF8 server encodings reject untranslatable characters, even inside comments.
      expect([...sql].every((char) => char.charCodeAt(0) <= 0x7f), `${entry.name} must be ASCII`).toBe(true);
      // The migrator role has no CREATE on the database (ADR 0004).
      expect(sql, entry.name).not.toMatch(/^\s*CREATE SCHEMA/m);
    }
  });

  it('V1-19: the datasource has no hard-coded url', () => {
    const datasource = /datasource db \{([\s\S]*?)\}/.exec(schema)?.[1] ?? '';
    expect(datasource).not.toMatch(/url\s*=/);
    expect(datasource).toMatch(/provider\s*=\s*"postgresql"/);
  });
});
