import { createDbClient, withSystemScope } from '@notify/db';
import { apiEnvSchema, createLogger, EnvValidationError, parseEnv } from '@notify/shared/server';
import { Redis } from 'ioredis';
import { buildApp } from './app.js';

async function main(): Promise<void> {
  let env;
  try {
    env = parseEnv(apiEnvSchema, process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // Logger is not configured yet; write the variable names (never values) and refuse to start.
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ service: 'api', level: env.LOG_LEVEL });
  const db = createDbClient({ connectionString: env.DATABASE_URL });
  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 5_000,
  });
  redis.on('error', (error: Error) => logger.error({ err: error }, 'redis connection error'));
  await redis.connect();

  const app = await buildApp({
    logger,
    redis,
    config: {
      corsOrigins: env.CORS_ORIGINS,
      bodyLimitBytes: env.BODY_LIMIT_BYTES,
      requestTimeoutMs: env.REQUEST_TIMEOUT_MS,
      rateLimitPerMinute: env.RATE_LIMIT_GLOBAL_PER_MINUTE,
      trustProxyHops: env.TRUST_PROXY_HOPS,
      publicApiUrl: env.PUBLIC_API_URL,
    },
    healthChecks: {
      database: async () => {
        await withSystemScope('readiness probe', () => db.$queryRaw`SELECT 1`);
      },
      redis: async () => {
        if ((await redis.ping()) !== 'PONG') throw new Error('unexpected redis ping reply');
      },
    },
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const timer = setTimeout(() => {
      logger.error('graceful shutdown timed out');
      process.exit(1);
    }, env.SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      // Stops accepting connections and waits for in-flight requests.
      await app.close();
      await db.$disconnect();
      await redis.quit();
      logger.info('shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
      process.exit(1);
    }
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    void shutdown('unhandledRejection');
  });

  await app.listen({ host: env.HOST, port: env.PORT });
}

main().catch((error: unknown) => {
  // Startup failures (unreachable database/redis, bad config): no stack traces with connection details.
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
  process.stderr.write(`fatal: startup failed (${reason})\n`);
  process.exit(1);
});
