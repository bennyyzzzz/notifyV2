import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';

export type HealthCheck = () => Promise<void>;

const CHECK_TIMEOUT_MS = 2_000;

const statusSchema = z.strictObject({ status: z.enum(['ok', 'unavailable']) });

function withTimeout(check: HealthCheck): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('health check timed out')), CHECK_TIMEOUT_MS);
    check().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error('health check failed'));
      },
    );
  });
}

/** Public probes. They never reveal which dependency failed or any version information. */
export const healthRoutes: FastifyPluginAsyncZod<{ checks: Record<string, HealthCheck> }> = async (app, options) => {
  app.get(
    '/health/live',
    {
      config: { auth: 'public', rateLimit: false },
      schema: { hide: true, response: { 200: statusSchema } },
    },
    async () => ({ status: 'ok' as const }),
  );

  app.get(
    '/health/ready',
    {
      config: { auth: 'public', rateLimit: false },
      schema: { hide: true, response: { 200: statusSchema, 503: statusSchema } },
    },
    async (request, reply) => {
      const results = await Promise.allSettled(
        Object.entries(options.checks).map(async ([name, check]) => {
          try {
            await withTimeout(check);
          } catch (error) {
            request.log.warn({ err: error, dependency: name }, 'readiness check failed');
            throw error;
          }
        }),
      );
      const healthy = results.every((result) => result.status === 'fulfilled');
      return reply.code(healthy ? 200 : 503).send({ status: healthy ? 'ok' : 'unavailable' });
    },
  );
};
