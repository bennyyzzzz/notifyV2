import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NotifyApp } from '@notify/api/app';
import { CryptoError, decryptEnvelope, encryptEnvelope, LocalKeyRing, parseKeyRingSpec } from '@notify/crypto';
import { applyTenantScope, TenantScopeViolationError } from '@notify/db';
import { apiEnvSchema, EnvValidationError, parseEnv } from '@notify/shared/server';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { securityTestApp } from '../support/app.js';
import { listRepoFiles, readRepoFile, REPO_ROOT, repoRelative } from '../support/repo.js';

const ORG_A = '0192a5c4-0000-7000-8000-00000000000a';
const APP_A = '0192a5c4-0000-7000-8000-0000000000a1';
const APP_B = '0192a5c4-0000-7000-8000-0000000000b1';
const migrationSql = readFileSync(join(REPO_ROOT, 'packages/db/prisma/migrations/20261007000000_init/migration.sql'), 'utf8');

let app: NotifyApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('3.1 — critical v1 failures', () => {
  it('V1-01: sending endpoints are never reachable without authentication', async () => {
    app = await securityTestApp({
      registerApiRoutes: async (api) => {
        api.post('/send-notification', async () => ({ sent: true }));
        api.post('/notifications/:id/send', async () => ({ sent: true }));
      },
    });
    for (const url of ['/api/v1/send-notification', '/api/v1/notifications/0192a5c4-0000-7000-8000-000000000001/send']) {
      const response = await app.inject({ method: 'POST', url, payload: { firebaseIntegrationId: 'any' } });
      expect(response.statusCode, url).toBe(401);
    }
  });

  it('V1-01: a send route cannot be declared public', async () => {
    await expect(
      securityTestApp({
        registerApiRoutes: async (api) => {
          api.post('/send-notification', { config: { auth: 'public' } }, async () => ({ sent: true }));
        },
      }),
    ).rejects.toThrow(/public allowlist/);
  });

  it('V1-02: resources of another app cannot be reached by passing appId in the input', () => {
    const scope = { kind: 'tenant' as const, organizationId: ORG_A, appId: APP_A };
    expect(() => applyTenantScope('Notification', 'update', { where: { id: 'n1', appId: APP_B }, data: {} }, scope)).toThrow(
      TenantScopeViolationError,
    );
    expect(applyTenantScope('Notification', 'delete', { where: { id: 'n1' } }, scope)).toEqual({
      where: { id: 'n1', organizationId: ORG_A, appId: APP_A },
    });
  });

  it('V1-03: the database rejects a Firebase integration from another app (composite FKs)', () => {
    for (const table of ['notifications', 'automation_rules']) {
      expect(migrationSql).toContain(
        `ALTER TABLE "${table}" ADD CONSTRAINT "${table}_firebase_integration_id_app_id_fkey" FOREIGN KEY ("firebase_integration_id", "app_id") REFERENCES "firebase_integrations"("id", "app_id")`,
      );
    }
    expect(migrationSql).toContain('REFERENCES "apps"("id", "organization_id")');
  });

  it('V1-04: the v1 public /events endpoint does not exist; ingestion lives only under /v1/ingest/*', async () => {
    app = await securityTestApp();
    const response = await app.inject({ method: 'POST', url: '/events', payload: { eventKey: 'x', fcmToken: 'y' } });
    expect(response.statusCode).toBe(404);
  });
  it.todo('V1-04: ingestion requires IngestKey + allowed Origin, rate limits, allowedEvents and consent-only tokens (phase 6)');

  it('V1-05: AI generation is not reachable without authentication', async () => {
    app = await securityTestApp({
      registerApiRoutes: async (api) => {
        api.post('/apps/:appId/campaigns/:id/generate', async () => ({ options: [] }));
      },
    });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/apps/0192a5c4-0000-7000-8000-0000000000a1/campaigns/0192a5c4-0000-7000-8000-0000000000c1/generate',
    });
    expect(response.statusCode).toBe(401);
  });
  it.todo('V1-05: AI generation enforces role, per-app quota and 10/min per user (phase 4)');

  it.todo('V1-06: listing app members requires master, org_admin or app admin (phase 3)');

  it('V1-07: unknown fields such as status/campaignId are rejected instead of mass-assigned', async () => {
    app = await securityTestApp({
      authenticate: async () => ({ userId: 'u1', sessionId: 's1' }),
      registerApiRoutes: async (api) => {
        api.patch(
          '/notifications/:id',
          { schema: { body: z.strictObject({ title: z.string().max(65).optional(), body: z.string().max(240).optional() }) } },
          async () => ({ ok: true }),
        );
      },
    });
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/notifications/0192a5c4-0000-7000-8000-000000000001',
      payload: { title: 'Oi', status: 'sent', campaignId: 'other' },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().errors[0].code).toBe('unrecognized_keys');
  });

  it('V1-08: secrets use AES-256-GCM envelopes, detect tampering and have no fallback key', async () => {
    const ring = LocalKeyRing.fromSpec(`k1:${randomBytes(32).toString('base64')}`, 'k1');
    const envelope = await encryptEnvelope('-----BEGIN PRIVATE KEY-----', ring, 'firebase_integration:x');
    const tampered = { ...envelope, ciphertext: Buffer.from(envelope.ciphertext.map((b) => b ^ 1)) };
    await expect(decryptEnvelope(tampered, ring, 'firebase_integration:x')).rejects.toBeInstanceOf(CryptoError);
    expect(() => parseKeyRingSpec(`k1:${Buffer.from('default-secret-key-default-secret').toString('base64')}`)).toThrow();

    const cryptoSources = listRepoFiles(join(REPO_ROOT, 'packages/crypto/src')).map(readRepoFile).join('\n');
    expect(cryptoSources).not.toMatch(/aes-256-cbc|default-secret-key|createHash\('sha256'\)\.update\(.*secret/i);
  });

  it('V1-08: the API refuses to start without ENCRYPTION_KEYS', () => {
    expect(() =>
      parseEnv(apiEnvSchema, {
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://u:p@db/notify?sslmode=require',
        REDIS_URL: 'rediss://redis:6380',
        TOKEN_PEPPER: randomBytes(32).toString('base64'),
        PUBLIC_API_URL: 'https://api.notify.test',
        CORS_ORIGINS: 'https://app.notify.test',
      }),
    ).toThrow(EnvValidationError);
  });

  it('V1-09: no environment files or default credentials are committed', () => {
    const files = listRepoFiles();
    const envFiles = files.map(repoRelative).filter((path) => /(^|\/)\.env(\.|$)/.test(path) && !path.endsWith('.env.example'));
    expect(envFiles).toEqual([]);

    const codeFiles = files.filter((path) => !path.endsWith('.md') && !repoRelative(path).startsWith('tests/security/'));
    for (const path of codeFiles) {
      const content = readRepoFile(path);
      // v1 default credentials, and v1-style secrets assigned to configuration keys.
      // (Bare words like "minha-chave" legitimately appear in the weak-secret detectors.)
      expect(content, repoRelative(path)).not.toMatch(/admin123|master@notify\.com/);
      expect(content, repoRelative(path)).not.toMatch(/(SECRET|KEY|PEPPER)\w*\s*[=:]\s*["']?(minha-chave|uma-chave|default-secret)/i);
    }

    expect(readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8')).toMatch(/^\.env$/m);
  });

  it('V1-09: .env.example ships without secret values', () => {
    const example = readFileSync(join(REPO_ROOT, '.env.example'), 'utf8');
    for (const name of ['ENCRYPTION_KEYS', 'TOKEN_PEPPER']) {
      const line = example.split('\n').find((l) => l.startsWith(`${name}=`));
      expect(line, name).toBe(`${name}=`);
    }
    expect(existsSync(join(REPO_ROOT, 'packages/db/prisma/seed.ts'))).toBe(false);
  });
});
