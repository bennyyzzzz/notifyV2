import swagger from '@fastify/swagger';
import { resolveCorrelationId, type Logger } from '@notify/shared/server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance, type RawServerDefault } from 'fastify';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { authGuardPlugin, denyAllAuthenticator, type Authenticator } from './plugins/auth-guard.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { securityPlugin } from './plugins/security.js';
import { healthRoutes, type HealthCheck } from './routes/health.js';

// Validation messages in pt-BR (UI language); codes stay machine-readable.
z.config(z.locales.pt());

export const API_PREFIX = '/api/v1';

export type NotifyApp = FastifyInstance<RawServerDefault, IncomingMessage, ServerResponse, FastifyBaseLogger, ZodTypeProvider>;

export interface AppConfig {
  corsOrigins: readonly string[];
  bodyLimitBytes: number;
  requestTimeoutMs: number;
  rateLimitPerMinute: number;
  trustProxyHops: number;
  publicApiUrl: string;
}

export interface BuildAppOptions {
  config: AppConfig;
  logger: Logger;
  healthChecks: Record<string, HealthCheck>;
  authenticate?: Authenticator;
  redis?: Redis;
  /** Registers routes under /api/v1 — used by later phases and by tests. */
  registerApiRoutes?: (api: NotifyApp) => Promise<void>;
}

export async function buildApp(options: BuildAppOptions): Promise<NotifyApp> {
  const { config } = options;

  const app = Fastify({
    loggerInstance: options.logger as FastifyBaseLogger,
    genReqId: (request) => resolveCorrelationId(request.headers['x-correlation-id']),
    logController: new LogController({ requestIdLogLabel: 'correlationId' }),
    bodyLimit: config.bodyLimitBytes,
    requestTimeout: config.requestTimeoutMs,
    connectionTimeout: 10_000,
    keepAliveTimeout: 72_000,
    // Trust exactly N reverse-proxy hops so request.ip cannot be spoofed via X-Forwarded-For.
    trustProxy: config.trustProxyHops > 0 ? (_address: string, hop: number) => hop < config.trustProxyHops : false,
    return503OnClosing: true,
    routerOptions: { maxParamLength: 200 },
    ajv: { customOptions: { removeAdditional: false } },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.addHook('onSend', async (request, reply) => {
    reply.header('x-correlation-id', request.id);
    reply.header('cache-control', 'no-store');
  });

  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: { title: 'Notify API', version: '2.0.0' },
      servers: [{ url: config.publicApiUrl }],
    },
    transform: jsonSchemaTransform,
  });

  await app.register(errorHandlerPlugin);
  const securityOptions: Parameters<typeof securityPlugin>[1] = {
    corsOrigins: config.corsOrigins,
    rateLimitPerMinute: config.rateLimitPerMinute,
  };
  if (options.redis) securityOptions.redis = options.redis;
  await app.register(securityPlugin, securityOptions);
  await app.register(authGuardPlugin, { authenticate: options.authenticate ?? denyAllAuthenticator });

  await app.register(healthRoutes, { checks: options.healthChecks });

  await app.register(
    async (api) => {
      if (options.registerApiRoutes) await options.registerApiRoutes(api);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
