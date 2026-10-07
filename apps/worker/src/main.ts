import { hostname } from 'node:os';
import { createDbClient, withSystemScope } from '@notify/db';
import { createLogger, EnvValidationError, parseEnv, workerEnvSchema } from '@notify/shared/server';
import { Redis } from 'ioredis';
import { shutdownAll } from './lifecycle.js';

const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_TTL_SECONDS = 30;

async function main(): Promise<void> {
  let env;
  try {
    env = parseEnv(workerEnvSchema, process.env);
  } catch (error) {
    if (error instanceof EnvValidationError) {
      process.stderr.write(`${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }

  const logger = createLogger({ service: 'worker', level: env.LOG_LEVEL });
  const db = createDbClient({ connectionString: env.DATABASE_URL, poolMax: env.WORKER_CONCURRENCY + 2 });
  // BullMQ requires maxRetriesPerRequest: null on its connections (phase 5).
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: null, connectTimeout: 5_000 });
  redis.on('error', (error: Error) => logger.error({ err: error }, 'redis connection error'));
  await redis.connect();
  await withSystemScope('worker startup connectivity check', () => db.$queryRaw`SELECT 1`);

  const instanceId = `${hostname()}:${process.pid}`;
  const beat = async (): Promise<void> => {
    try {
      await redis.set(`notify:worker:heartbeat:${instanceId}`, new Date().toISOString(), 'EX', HEARTBEAT_TTL_SECONDS);
    } catch (error) {
      logger.warn({ err: error }, 'heartbeat failed');
    }
  };
  await beat();
  const heartbeat = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);

  logger.info({ instanceId, concurrency: env.WORKER_CONCURRENCY }, 'worker ready');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    clearInterval(heartbeat);
    const code = await shutdownAll(
      [
        // Phase 5: queue workers are closed first so in-flight jobs finish or return to the queue.
        { name: 'heartbeat', close: () => redis.del(`notify:worker:heartbeat:${instanceId}`) },
        { name: 'database', close: () => db.$disconnect() },
        { name: 'redis', close: () => redis.quit() },
      ],
      logger,
      env.SHUTDOWN_TIMEOUT_MS,
    );
    process.exit(code);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
    void shutdown('unhandledRejection');
  });
}

main().catch((error: unknown) => {
  // Startup failures (unreachable database/redis, bad config): no stack traces with connection details.
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error';
  process.stderr.write(`fatal: startup failed (${reason})\n`);
  process.exit(1);
});
