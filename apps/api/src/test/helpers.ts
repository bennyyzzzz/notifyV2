import { createLogger } from '@notify/shared/server';
import { buildApp, type AppConfig, type BuildAppOptions, type NotifyApp } from '../app.js';
import type { Authenticator } from '../plugins/auth-guard.js';

export const TEST_ORIGIN = 'https://app.notify.test';

export const testConfig: AppConfig = {
  corsOrigins: [TEST_ORIGIN],
  bodyLimitBytes: 1024,
  requestTimeoutMs: 5_000,
  rateLimitPerMinute: 1_000,
  trustProxyHops: 0,
  publicApiUrl: 'https://api.notify.test',
};

/** Authenticates requests carrying `x-test-user` (tests only). */
export const headerAuthenticator: Authenticator = async (request) => {
  const user = request.headers['x-test-user'];
  return typeof user === 'string' ? { userId: user, sessionId: 'test-session' } : null;
};

export async function buildTestApp(overrides: Partial<BuildAppOptions> = {}): Promise<NotifyApp> {
  const app = await buildApp({
    logger: createLogger({ service: 'api', level: 'silent' }),
    healthChecks: { database: async () => undefined },
    config: testConfig,
    ...overrides,
  });
  await app.ready();
  return app;
}
