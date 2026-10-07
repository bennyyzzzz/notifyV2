import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { apiEnvSchema, EnvValidationError, parseEnv, workerEnvSchema } from './env.js';

const key = () => randomBytes(32).toString('base64');

function validApiEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://notify:pw@localhost:5432/notify',
    REDIS_URL: 'redis://localhost:6379',
    ENCRYPTION_KEYS: `k1:${key()}`,
    ENCRYPTION_ACTIVE_KEY_ID: 'k1',
    TOKEN_PEPPER: key(),
    PUBLIC_API_URL: 'http://localhost:3001',
    CORS_ORIGINS: 'http://localhost:5173, https://app.notify.example',
    ...overrides,
  };
}

function issuesOf(fn: () => unknown): readonly string[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvValidationError) return error.issues;
    throw error;
  }
  throw new Error('expected EnvValidationError');
}

describe('api env', () => {
  it('parses a valid development env with defaults', () => {
    const env = parseEnv(apiEnvSchema, validApiEnv());
    expect(env.PORT).toBe(3001);
    expect(env.BODY_LIMIT_BYTES).toBe(102_400);
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173', 'https://app.notify.example']);
    expect(env.OPENAPI_ENABLED).toBe(false);
  });

  it('reports every missing variable by name, treating blanks as missing', () => {
    const issues = issuesOf(() => parseEnv(apiEnvSchema, { NODE_ENV: 'development', TOKEN_PEPPER: '  ' }));
    expect(issues).toEqual(
      expect.arrayContaining([
        'DATABASE_URL: is required',
        'REDIS_URL: is required',
        'ENCRYPTION_KEYS: is required',
        'TOKEN_PEPPER: is required',
        'PUBLIC_API_URL: is required',
        'CORS_ORIGINS: is required',
      ]),
    );
  });

  it('V1-08/V1-09: refuses weak or placeholder secrets and never echoes values', () => {
    const weak = Buffer.from('minha-chave-secreta-de-32-bytes!').toString('base64');
    const issues = issuesOf(() =>
      parseEnv(apiEnvSchema, validApiEnv({ TOKEN_PEPPER: 'change-me', ENCRYPTION_KEYS: `k1:${weak}` })),
    );
    expect(issues.some((issue) => issue.startsWith('TOKEN_PEPPER'))).toBe(true);
    expect(issues.some((issue) => issue.startsWith('ENCRYPTION_KEYS'))).toBe(true);
    expect(issues.join('\n')).not.toContain(weak);

    expect(issuesOf(() => parseEnv(apiEnvSchema, validApiEnv({ TOKEN_PEPPER: 'not base64!' })))[0]).toMatch(/canonical base64/);
    expect(
      issuesOf(() => parseEnv(apiEnvSchema, validApiEnv({ TOKEN_PEPPER: randomBytes(16).toString('base64') })))[0],
    ).toMatch(/at least 32 bytes/);
  });

  it('requires the active key id to be in the key ring', () => {
    expect(issuesOf(() => parseEnv(apiEnvSchema, validApiEnv({ ENCRYPTION_ACTIVE_KEY_ID: 'k2' })))).toEqual([
      'ENCRYPTION_ACTIVE_KEY_ID: must reference a key in ENCRYPTION_KEYS',
    ]);
  });

  it('V1-18: rejects malformed CORS origins', () => {
    const issues = issuesOf(() => parseEnv(apiEnvSchema, validApiEnv({ CORS_ORIGINS: 'https://app.example.com/path,*' })));
    expect(issues).toHaveLength(2);
  });

  it('rejects invalid URLs and protocols', () => {
    const issues = issuesOf(() =>
      parseEnv(apiEnvSchema, validApiEnv({ DATABASE_URL: 'file:./dev.db', REDIS_URL: 'not a url' })),
    );
    expect(issues).toEqual(['DATABASE_URL: protocol must be one of postgres:, postgresql:', 'REDIS_URL: must be a valid URL']);
  });

  it('enforces TLS and https in production', () => {
    const issues = issuesOf(() => parseEnv(apiEnvSchema, validApiEnv({ NODE_ENV: 'production' })));
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^DATABASE_URL: must use sslmode/),
        expect.stringMatching(/^REDIS_URL: must use TLS/),
        'CORS_ORIGINS: origins must be https in production',
        'PUBLIC_API_URL: must be https in production',
      ]),
    );

    const env = parseEnv(
      apiEnvSchema,
      validApiEnv({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://notify:pw@db:5432/notify?sslmode=verify-full',
        REDIS_URL: 'rediss://redis:6380',
        CORS_ORIGINS: 'https://app.notify.example',
        PUBLIC_API_URL: 'https://api.notify.example',
      }),
    );
    expect(env.NODE_ENV).toBe('production');
  });
});

describe('worker env', () => {
  it('parses with defaults', () => {
    const env = parseEnv(workerEnvSchema, validApiEnv());
    expect(env.WORKER_CONCURRENCY).toBe(10);
    expect(env.SHUTDOWN_TIMEOUT_MS).toBe(25_000);
  });

  it('rejects a broken key ring', () => {
    expect(issuesOf(() => parseEnv(workerEnvSchema, validApiEnv({ ENCRYPTION_KEYS: 'garbage' })))[0]).toMatch(
      /^ENCRYPTION_KEYS:/,
    );
  });
});
