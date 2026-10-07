import { buildApp, type BuildAppOptions, type NotifyApp } from '@notify/api/app';
import { createLogger } from '@notify/shared/server';

export const ALLOWED_ORIGIN = 'https://app.notify.test';

export async function securityTestApp(overrides: Partial<BuildAppOptions> = {}): Promise<NotifyApp> {
  const app = await buildApp({
    logger: createLogger({ service: 'api', level: 'silent' }),
    healthChecks: {},
    config: {
      corsOrigins: [ALLOWED_ORIGIN],
      bodyLimitBytes: 100 * 1024,
      requestTimeoutMs: 5_000,
      rateLimitPerMinute: 1_000,
      trustProxyHops: 0,
      publicApiUrl: 'https://api.notify.test',
    },
    ...overrides,
  });
  await app.ready();
  return app;
}
