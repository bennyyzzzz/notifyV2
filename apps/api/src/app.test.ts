import { TenantScopeViolationError } from '@notify/db';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { NotifyApp } from './app.js';
import { HttpProblem } from './errors.js';
import { isAllowlistedPublicRoute } from './plugins/auth-guard.js';
import { buildTestApp, headerAuthenticator, TEST_ORIGIN, testConfig } from './test/helpers.js';

let app: NotifyApp | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function registerDemoRoutes(typed: NotifyApp): Promise<void> {
  typed.post(
    '/demo',
    { schema: { body: z.strictObject({ title: z.string().min(1).max(50) }) } },
    async (request) => ({ ok: true, title: request.body.title, user: request.principal?.userId }),
  );
  typed.get('/boom', async () => {
    throw new Error('PrismaClientKnownRequestError: relation "users" password_hash leaked');
  });
  typed.get('/tenant-bug', async () => {
    throw new TenantScopeViolationError('Notification: where.appId conflicts with the tenant context');
  });
  typed.get('/conflict', async () => {
    throw new HttpProblem('versionConflict');
  });
}

describe('deny by default (§6.3, V1-01, V1-05)', () => {
  it('rejects unauthenticated calls to non-public routes with 401 problem+json', async () => {
    app = await buildTestApp({ registerApiRoutes: registerDemoRoutes });
    const response = await app.inject({ method: 'POST', url: '/api/v1/demo', payload: { title: 'Oi' } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toEqual({
      type: 'urn:notify:problem:unauthorized',
      title: 'Autenticação necessária.',
      status: 401,
      correlationId: response.headers['x-correlation-id'],
    });
  });

  it('lets authenticated calls through and exposes the principal', async () => {
    app = await buildTestApp({ registerApiRoutes: registerDemoRoutes, authenticate: headerAuthenticator });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/demo',
      headers: { 'x-test-user': 'u1' },
      payload: { title: 'Oi' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, title: 'Oi', user: 'u1' });
  });

  it('refuses to start when a non-allowlisted route is declared public', async () => {
    await expect(
      buildTestApp({
        registerApiRoutes: async (api) => {
          api.post('/send-notification', { config: { auth: 'public' } }, async () => ({ sent: true }));
        },
      }),
    ).rejects.toThrow(/not in the public allowlist/);
  });

  it('allowlist matches only the paths of §6.3', () => {
    for (const url of [
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/mfa/verify',
      '/api/v1/auth/password-reset/request',
      '/api/v1/auth/invite/accept',
      '/v1/ingest/events',
      '/health/live',
      '/sdk/v2/notify.min.js',
    ]) {
      expect(isAllowlistedPublicRoute(url), url).toBe(true);
    }
    for (const url of ['/api/v1/send-notification', '/api/v1/generate-push-options', '/api/v1/auth/login/x', '/events', '/api/v1/apps/:appId/users']) {
      expect(isAllowlistedPublicRoute(url), url).toBe(false);
    }
  });
});

describe('RFC 7807 errors (V1-12)', () => {
  it('returns a generic 500 without internal details', async () => {
    app = await buildTestApp({ registerApiRoutes: registerDemoRoutes, authenticate: headerAuthenticator });
    const response = await app.inject({ method: 'GET', url: '/api/v1/boom', headers: { 'x-test-user': 'u1' } });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toMatch(/Prisma|password_hash|stack|details/i);
    expect(response.json()).toMatchObject({ type: 'urn:notify:problem:internal', status: 500 });
  });

  it('treats tenant guard violations as internal errors', async () => {
    app = await buildTestApp({ registerApiRoutes: registerDemoRoutes, authenticate: headerAuthenticator });
    const response = await app.inject({ method: 'GET', url: '/api/v1/tenant-bug', headers: { 'x-test-user': 'u1' } });
    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('appId');
  });

  it('maps HttpProblem kinds', async () => {
    app = await buildTestApp({ registerApiRoutes: registerDemoRoutes, authenticate: headerAuthenticator });
    const response = await app.inject({ method: 'GET', url: '/api/v1/conflict', headers: { 'x-test-user': 'u1' } });
    expect(response.statusCode).toBe(409);
    expect(response.json().title).toBe('Esta notificação foi alterada por outra pessoa.');
  });

  it('returns 404 problems for unknown routes', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/nope' });
    expect(response.statusCode).toBe(404);
    expect(response.json().type).toBe('urn:notify:problem:not-found');
  });

  it('V1-07: rejects unknown fields (strict schemas) with field errors in pt-BR', async () => {
    app = await buildTestApp({ registerApiRoutes: registerDemoRoutes, authenticate: headerAuthenticator });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/demo',
      headers: { 'x-test-user': 'u1' },
      payload: { title: 'Oi', status: 'sent' },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.type).toBe('urn:notify:problem:validation');
    expect(body.errors).toEqual([expect.objectContaining({ code: 'unrecognized_keys' })]);
  });

  it('rejects malformed JSON and oversized bodies (V1-20)', async () => {
    app = await buildTestApp({ registerApiRoutes: registerDemoRoutes, authenticate: headerAuthenticator });
    const malformed = await app.inject({
      method: 'POST',
      url: '/api/v1/demo',
      headers: { 'x-test-user': 'u1', 'content-type': 'application/json' },
      payload: '{"title":',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().type).toBe('urn:notify:problem:bad-request');

    const oversized = await app.inject({
      method: 'POST',
      url: '/api/v1/demo',
      headers: { 'x-test-user': 'u1' },
      payload: { title: 'x'.repeat(testConfig.bodyLimitBytes) },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().type).toBe('urn:notify:problem:payload-too-large');
  });

  it('rejects unsupported content types', async () => {
    app = await buildTestApp({ registerApiRoutes: registerDemoRoutes, authenticate: headerAuthenticator });
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/demo',
      headers: { 'x-test-user': 'u1', 'content-type': 'application/xml' },
      payload: '<title/>',
    });
    expect(response.statusCode).toBe(415);
  });
});

describe('correlation id', () => {
  it('echoes a safe inbound id and generates one otherwise', async () => {
    app = await buildTestApp();
    const echoed = await app.inject({ method: 'GET', url: '/health/live', headers: { 'x-correlation-id': 'trace-abc-123' } });
    expect(echoed.headers['x-correlation-id']).toBe('trace-abc-123');
    const replaced = await app.inject({ method: 'GET', url: '/health/live', headers: { 'x-correlation-id': 'a\u0000b' } });
    expect(replaced.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('security headers and CORS (V1-18, V1-20)', () => {
  it('sets helmet headers with a strict CSP and HSTS', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('allows only configured origins', async () => {
    app = await buildTestApp();
    const allowed = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/anything',
      headers: { origin: TEST_ORIGIN, 'access-control-request-method': 'POST' },
    });
    expect(allowed.statusCode).toBe(204);
    expect(allowed.headers['access-control-allow-origin']).toBe(TEST_ORIGIN);
    expect(allowed.headers['access-control-allow-credentials']).toBe('true');

    const denied = await app.inject({
      method: 'OPTIONS',
      url: '/api/v1/anything',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('limits per IP before authentication and answers with a 429 problem', async () => {
    app = await buildTestApp({
      config: { ...testConfig, rateLimitPerMinute: 2 },
      registerApiRoutes: registerDemoRoutes,
    });
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      statuses.push((await app.inject({ method: 'POST', url: '/api/v1/demo', payload: { title: 'x' } })).statusCode);
    }
    expect(statuses).toEqual([401, 401, 429]);
    const limited = await app.inject({ method: 'POST', url: '/api/v1/demo', payload: { title: 'x' } });
    expect(limited.json()).toMatchObject({ type: 'urn:notify:problem:rate-limited', status: 429 });
    expect(limited.headers['retry-after']).toBeDefined();
  });
});

describe('health probes', () => {
  it('reports liveness and readiness without dependency details', async () => {
    app = await buildTestApp({ healthChecks: { database: async () => undefined, redis: async () => undefined } });
    expect((await app.inject({ method: 'GET', url: '/health/live' })).json()).toEqual({ status: 'ok' });
    const ready = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toEqual({ status: 'ok' });
  });

  it('returns 503 when a dependency fails, hiding which one', async () => {
    app = await buildTestApp({
      healthChecks: {
        database: async () => {
          throw new Error('ECONNREFUSED 10.0.0.5:5432');
        },
      },
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.body).toBe('{"status":"unavailable"}');
  });
});
