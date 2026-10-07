import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { resolveCorrelationId } from './correlation.js';
import { createLogger } from './logger.js';

function capture() {
  const lines: Record<string, unknown>[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      lines.push(JSON.parse(chunk.toString('utf8')) as Record<string, unknown>);
      callback();
    },
  });
  return { lines, logger: createLogger({ service: 'api', level: 'info', destination }) };
}

describe('logger redaction', () => {
  it('redacts credentials, tokens and private keys at several depths', async () => {
    const { lines, logger } = capture();
    logger.info(
      {
        req: { headers: { authorization: 'Bearer abc', cookie: '__Host-refresh=xyz', 'user-agent': 'vitest' } },
        password: 'hunter2hunter2',
        integration: { private_key: '-----BEGIN PRIVATE KEY-----', projectId: 'demo' },
        device: { fcmToken: 'fcm-token-value' },
        nested: { deeper: { token: 'refresh-token-value' } },
      },
      'test',
    );
    await new Promise((resolve) => setImmediate(resolve));
    const serialized = JSON.stringify(lines);
    for (const secret of ['Bearer abc', '__Host-refresh=xyz', 'hunter2hunter2', 'BEGIN PRIVATE KEY', 'fcm-token-value', 'refresh-token-value']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('vitest');
    expect(serialized).toContain('demo');
    expect(lines[0]).toMatchObject({ level: 'info', service: 'api', msg: 'test' });
  });
});

describe('correlation id', () => {
  it('keeps safe inbound ids and replaces unsafe ones', () => {
    expect(resolveCorrelationId('req-12345678')).toBe('req-12345678');
    expect(resolveCorrelationId(['abcdefgh-1', 'x'])).toBe('abcdefgh-1');
    const generated = resolveCorrelationId('bad\nid injected');
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveCorrelationId(undefined)).not.toBe(generated);
  });
});
