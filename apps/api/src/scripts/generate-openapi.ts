// Writes docs/api/openapi.json from the route schemas. No secrets or connections are needed.
import { mkdirSync, writeFileSync } from 'node:fs';
import { createLogger } from '@notify/shared/server';
import { buildApp } from '../app.js';

const app = await buildApp({
  logger: createLogger({ service: 'cli', level: 'silent' }),
  healthChecks: {},
  config: {
    corsOrigins: [],
    bodyLimitBytes: 102_400,
    requestTimeoutMs: 15_000,
    rateLimitPerMinute: 300,
    trustProxyHops: 0,
    publicApiUrl: process.env.PUBLIC_API_URL ?? 'https://api.example.invalid',
  },
});
await app.ready();

const target = new URL('../../../../docs/api/', import.meta.url);
mkdirSync(target, { recursive: true });
writeFileSync(new URL('openapi.json', target), `${JSON.stringify(app.swagger(), null, 2)}\n`);
await app.close();
console.log('docs/api/openapi.json updated');
