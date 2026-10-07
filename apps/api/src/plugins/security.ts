import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';
import { HttpProblem } from '../errors.js';

export interface SecurityOptions {
  corsOrigins: readonly string[];
  rateLimitPerMinute: number;
  /** Shared store so limits hold across instances. Omitted only in tests. */
  redis?: Redis;
}

export const securityPlugin = fp(
  async (app: FastifyInstance, options: SecurityOptions) => {
    // The API only serves JSON: the strictest CSP possible. The web app ships its own CSP.
    await app.register(helmet, {
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      xFrameOptions: { action: 'deny' },
    });

    // Authenticated API: explicit allowlist (V1-18). Ingestion registers its own CORS policy
    // validated against IngestKey.allowedOrigins (phase 6), so it is excluded here.
    const allowed = new Set(options.corsOrigins);
    await app.register(cors, {
      origin: (origin, callback) => {
        callback(null, origin !== undefined && allowed.has(origin));
      },
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Idempotency-Key', 'If-Match', 'X-Correlation-Id'],
      exposedHeaders: ['X-Correlation-Id', 'Retry-After', 'ETag'],
      maxAge: 600,
      strictPreflight: true,
    });

    await app.register(rateLimit, {
      global: true,
      max: options.rateLimitPerMinute,
      timeWindow: '1 minute',
      ...(options.redis ? { redis: options.redis, nameSpace: 'notify:rl:global:' } : {}),
      keyGenerator: (request) => request.ip,
      errorResponseBuilder: () => new HttpProblem('rateLimited'),
      addHeadersOnExceeding: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true },
      addHeaders: { 'x-ratelimit-limit': true, 'x-ratelimit-remaining': true, 'x-ratelimit-reset': true, 'retry-after': true },
    });
  },
  { name: 'notify-security' },
);
