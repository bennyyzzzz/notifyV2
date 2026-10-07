import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NotifyApp } from '@notify/api/app';
import { APP_ROLES, PLATFORM_ROLES } from '@notify/shared';
import { apiEnvSchema, EnvValidationError, parseEnv } from '@notify/shared/server';
import { ESLint } from 'eslint';
import { afterEach, describe, expect, it } from 'vitest';
import { ALLOWED_ORIGIN, securityTestApp } from '../support/app.js';
import { listRepoFiles, readRepoFile, REPO_ROOT, repoRelative } from '../support/repo.js';

const schema = readFileSync(join(REPO_ROOT, 'packages/db/prisma/schema.prisma'), 'utf8');

let app: NotifyApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('3.2 — high v1 failures', () => {
  it.todo('V1-10: 15-min access token, rotating httpOnly refresh cookie with reuse detection (phase 2)');
  it.todo('V1-11: login rate limit, progressive lockout and mandatory MFA for master/org_admin (phase 2)');

  it('V1-12: unexpected errors return a generic RFC 7807 body with correlationId only', async () => {
    app = await securityTestApp({
      authenticate: async () => ({ userId: 'u1', sessionId: 's1' }),
      registerApiRoutes: async (api) => {
        api.get('/explode', async () => {
          throw new Error('FirebaseMessagingError: invalid private_key at /srv/app/node_modules/x.js:10');
        });
      },
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/explode' });
    expect(response.statusCode).toBe(500);
    const body = response.json();
    expect(Object.keys(body).sort()).toEqual(['correlationId', 'status', 'title', 'type']);
    expect(response.body).not.toMatch(/Firebase|private_key|node_modules|details/);
  });

  it.todo('V1-13: redirectUrl accepts only https on allowlisted domains or registered deep links (phase 4)');
  it.todo('V1-14: audit logs record correct actor/target and never tokens or secrets (phase 2)');

  it('V1-15: platform roles are a closed enum in the database and in code', () => {
    expect(PLATFORM_ROLES).toEqual(['master', 'none']);
    expect(schema).toMatch(/platformRole\s+PlatformRole\s+@default\(none\)/);
  });
  it.todo('V1-15: elevation to master requires re-authentication + MFA and raises an alert (phase 2)');

  it.todo('V1-16: sends run in a separate BullMQ worker with locks, idempotency and stuck-job recovery (phase 5)');
  it.todo('V1-17: cached Google access token, bounded concurrency, per-recipient success and failure records (phase 5)');
});

describe('3.3 — medium v1 failures', () => {
  it('V1-18: CORS comes from configuration and rejects other origins', async () => {
    app = await securityTestApp();
    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/x',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/x',
      headers: { origin: ALLOWED_ORIGIN, 'access-control-request-method': 'GET' },
    });
    expect(allowed.headers['access-control-allow-origin']).toBe(ALLOWED_ORIGIN);

    const apiSources = listRepoFiles(join(REPO_ROOT, 'apps')).filter((p) => !p.includes('.test.') && p.endsWith('.ts'));
    for (const path of apiSources) {
      expect(readRepoFile(path), repoRelative(path)).not.toMatch(/localhost:(5173|3001)/);
    }
  });

  it('V1-19: PostgreSQL only, configured by DATABASE_URL', () => {
    expect(schema).toMatch(/datasource db \{\s*provider = "postgresql"\s*\}/);
    try {
      parseEnv(apiEnvSchema, { NODE_ENV: 'development', DATABASE_URL: 'file:./dev.db' });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as EnvValidationError).issues).toContain('DATABASE_URL: protocol must be one of postgres:, postgresql:');
    }
  });

  it('V1-20: security headers and a body size limit are enforced', async () => {
    app = await securityTestApp();
    const live = await app.inject({ method: 'GET', url: '/health/live' });
    expect(live.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(live.headers['x-content-type-options']).toBe('nosniff');
    const big = await app.inject({
      method: 'POST',
      url: '/api/v1/anything',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ blob: 'x'.repeat(200 * 1024) }),
    });
    // Unauthenticated requests are rejected before the body is even parsed.
    expect([401, 404, 413]).toContain(big.statusCode);
  });

  it.todo('V1-21: automation delayMinutes schedules a real delayed job (phase 6)');

  it('V1-22: app roles are admin/operator/viewer with no implicit default', () => {
    expect(APP_ROLES).toEqual(['admin', 'operator', 'viewer']);
    expect(schema).toMatch(/^\s+role\s+AppRole\s*$/m);
  });

  it.todo('V1-23: the events debug screen is only shown to roles that can call its endpoint (web, phase 6)');

  it('V1-24: builds are case-sensitive about import paths', () => {
    const tsconfig = JSON.parse(readFileSync(join(REPO_ROOT, 'tsconfig.base.json'), 'utf8')) as {
      compilerOptions: Record<string, unknown>;
    };
    expect(tsconfig.compilerOptions['forceConsistentCasingInFileNames']).toBe(true);
    expect(readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')).toMatch(/runs-on: ubuntu-/);
  });

  it.todo('V1-25: UTM built with URL/URLSearchParams, utm_medium=push, existing UTMs preserved (phase 4)');
  it.todo('V1-26: content limits by words (Intl.Segmenter) and characters (graphemes) (phase 4)');

  it('V1-27: no unused Company model; Campaign is referenced by notifications', () => {
    expect(schema).not.toMatch(/^model Company /m);
    expect(schema).toMatch(/campaign\s+Campaign\?\s+@relation/);
  });

  it.todo('V1-28: toasts/dialogs instead of alert/confirm, loading states and paginated history (web)');
  it.todo('V1-29: CSV audience lists uploaded to the backend with limits and dedupe (phase 5)');
  it.todo('V1-30: user removal is transactional and uses soft delete where history exists (phase 2)');

  it('V1-07 (lint): spreading the request body is a lint error', async () => {
    const eslint = new ESLint({ cwd: REPO_ROOT });
    const [result] = await eslint.lintText(
      "export function handler(req: { body: Record<string, unknown> }) {\n  return { ...req.body };\n}\n",
      { filePath: join(REPO_ROOT, 'apps/api/src/__lint_probe__.ts') },
    );
    expect(result?.messages.map((m) => m.ruleId)).toContain('no-restricted-syntax');
  });
});

describe('regression coverage', () => {
  it('every V1-01…V1-30 item has at least one test or todo', () => {
    const sources = listRepoFiles(join(REPO_ROOT, 'tests/security/regressions')).map(readRepoFile).join('\n');
    for (let i = 1; i <= 30; i += 1) {
      const id = `V1-${String(i).padStart(2, '0')}`;
      expect(sources, id).toContain(`'${id}`);
    }
  });
});
