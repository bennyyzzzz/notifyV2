import type { Logger } from '@notify/shared/server';

export type Closeable = { name: string; close: () => Promise<unknown> };

/**
 * Ordered graceful shutdown (§11): stop taking work first, then release connections.
 * Resolves with the exit code; never throws.
 */
export async function shutdownAll(resources: readonly Closeable[], logger: Logger, timeoutMs: number): Promise<number> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
    timer.unref();
  });

  const closeAll = (async () => {
    let failed = false;
    for (const resource of resources) {
      try {
        await resource.close();
        logger.info({ resource: resource.name }, 'closed');
      } catch (error) {
        failed = true;
        logger.error({ err: error, resource: resource.name }, 'failed to close');
      }
    }
    return failed ? 'failed' : 'ok';
  })();

  const outcome = await Promise.race([closeAll, timeout]);
  if (timer) clearTimeout(timer);
  if (outcome === 'timeout') {
    logger.error({ timeoutMs }, 'graceful shutdown timed out');
    return 1;
  }
  return outcome === 'ok' ? 0 : 1;
}
