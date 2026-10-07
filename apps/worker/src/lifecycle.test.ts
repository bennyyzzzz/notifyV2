import { createLogger } from '@notify/shared/server';
import { describe, expect, it } from 'vitest';
import { shutdownAll } from './lifecycle.js';

const logger = createLogger({ service: 'worker', level: 'silent' });

describe('shutdownAll', () => {
  it('closes resources in order and returns 0', async () => {
    const order: string[] = [];
    const code = await shutdownAll(
      ['queue', 'database', 'redis'].map((name) => ({ name, close: async () => void order.push(name) })),
      logger,
      1_000,
    );
    expect(code).toBe(0);
    expect(order).toEqual(['queue', 'database', 'redis']);
  });

  it('keeps closing after a failure and returns 1', async () => {
    const order: string[] = [];
    const code = await shutdownAll(
      [
        { name: 'a', close: async () => Promise.reject(new Error('boom')) },
        { name: 'b', close: async () => void order.push('b') },
      ],
      logger,
      1_000,
    );
    expect(code).toBe(1);
    expect(order).toEqual(['b']);
  });

  it('returns 1 when the timeout elapses', async () => {
    const code = await shutdownAll([{ name: 'stuck', close: () => new Promise(() => undefined) }], logger, 20);
    expect(code).toBe(1);
  });
});
