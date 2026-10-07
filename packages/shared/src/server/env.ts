import { assertStrongKeyMaterial, CryptoError, parseKeyRingSpec } from '@notify/crypto';
import { z } from 'zod';

/**
 * Environment validation. Processes refuse to start when a variable is missing, malformed
 * or a secret is weak (V1-08, V1-09). Error messages name the variable, never its value.
 */

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const KNOWN_WEAK_MARKERS = ['change-me', 'changeme', 'default-secret', 'minha-chave', 'uma-chave', 'secret', 'password'];

const secretBase64 = (name: string) =>
  z.string().superRefine((value, ctx) => {
    const lowered = value.toLowerCase();
    if (KNOWN_WEAK_MARKERS.some((marker) => lowered.includes(marker))) {
      ctx.addIssue({ code: 'custom', message: `${name} contains a placeholder value` });
      return;
    }
    const decoded = Buffer.from(value, 'base64');
    if (decoded.toString('base64') !== value) {
      ctx.addIssue({ code: 'custom', message: `${name} must be canonical base64 (e.g. \`openssl rand -base64 32\`)` });
      return;
    }
    try {
      assertStrongKeyMaterial(decoded, name);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: error instanceof CryptoError ? error.message : `${name} is invalid` });
    }
  });

const url = (protocols: readonly string[]) =>
  z.string().superRefine((value, ctx) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      ctx.addIssue({ code: 'custom', message: 'must be a valid URL' });
      return;
    }
    if (!protocols.includes(parsed.protocol)) {
      ctx.addIssue({ code: 'custom', message: `protocol must be one of ${protocols.join(', ')}` });
    }
  });

const booleanFlag = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const positiveInt = (fallback: number, max: number) => z.coerce.number().int().positive().max(max).default(fallback);

const commonShape = {
  NODE_ENV: z.enum(['development', 'test', 'production']),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  DATABASE_URL: url(['postgres:', 'postgresql:']),
  REDIS_URL: url(['redis:', 'rediss:']),
  ENCRYPTION_KEYS: z.string().min(1),
  ENCRYPTION_ACTIVE_KEY_ID: z.string().min(1),
  TOKEN_PEPPER: secretBase64('TOKEN_PEPPER'),
  SHUTDOWN_TIMEOUT_MS: positiveInt(25_000, 120_000),
};

function validateKeyRing(env: { ENCRYPTION_KEYS: string; ENCRYPTION_ACTIVE_KEY_ID: string }, ctx: z.RefinementCtx): void {
  try {
    const keys = parseKeyRingSpec(env.ENCRYPTION_KEYS);
    if (!keys.has(env.ENCRYPTION_ACTIVE_KEY_ID)) {
      ctx.addIssue({ code: 'custom', path: ['ENCRYPTION_ACTIVE_KEY_ID'], message: 'must reference a key in ENCRYPTION_KEYS' });
    }
  } catch (error) {
    ctx.addIssue({
      code: 'custom',
      path: ['ENCRYPTION_KEYS'],
      message: error instanceof CryptoError ? error.message : 'is invalid',
    });
  }
}

function validateProductionTransport(
  env: { NODE_ENV: string; DATABASE_URL: string; REDIS_URL: string },
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV !== 'production') return;
  const sslmode = new URL(env.DATABASE_URL).searchParams.get('sslmode');
  if (sslmode !== 'require' && sslmode !== 'verify-ca' && sslmode !== 'verify-full') {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'must use sslmode=require|verify-ca|verify-full in production' });
  }
  if (!env.REDIS_URL.startsWith('rediss://')) {
    ctx.addIssue({ code: 'custom', path: ['REDIS_URL'], message: 'must use TLS (rediss://) in production' });
  }
}

export const workerEnvSchema = z
  .object({
    ...commonShape,
    WORKER_CONCURRENCY: positiveInt(10, 500),
  })
  .superRefine((env, ctx) => {
    validateKeyRing(env, ctx);
    validateProductionTransport(env, ctx);
  });

export const apiEnvSchema = z
  .object({
    ...commonShape,
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3001),
    PUBLIC_API_URL: url(['https:', 'http:']),
    CORS_ORIGINS: z
      .string()
      .min(1)
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
    BODY_LIMIT_BYTES: positiveInt(100 * 1024, 10 * 1024 * 1024),
    REQUEST_TIMEOUT_MS: positiveInt(15_000, 120_000),
    RATE_LIMIT_GLOBAL_PER_MINUTE: positiveInt(300, 100_000),
    OPENAPI_ENABLED: booleanFlag,
  })
  .superRefine((env, ctx) => {
    validateKeyRing(env, ctx);
    validateProductionTransport(env, ctx);

    for (const origin of env.CORS_ORIGINS) {
      let parsed: URL | undefined;
      try {
        parsed = new URL(origin);
      } catch {
        parsed = undefined;
      }
      if (!parsed || parsed.origin !== origin) {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: `"${origin}" is not a bare origin (scheme://host[:port])` });
      } else if (env.NODE_ENV === 'production' && parsed.protocol !== 'https:') {
        ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'origins must be https in production' });
      }
    }
    if (env.NODE_ENV === 'production' && !env.PUBLIC_API_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['PUBLIC_API_URL'], message: 'must be https in production' });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export type WorkerEnv = z.infer<typeof workerEnvSchema>;

export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

/** Parses `source` (normally `process.env`). Empty strings are treated as missing. */
export function parseEnv<S extends z.ZodType>(schema: S, source: Record<string, string | undefined>): z.infer<S> {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value.trim() !== '') cleaned[key] = value;
  }
  const result = schema.safeParse(cleaned);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)';
      return issue.code === 'invalid_type' && issue.input === undefined ? `${path}: is required` : `${path}: ${issue.message}`;
    });
    throw new EnvValidationError(issues);
  }
  return result.data;
}
