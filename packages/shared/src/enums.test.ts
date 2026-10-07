import { describe, expect, it } from 'vitest';
import * as enums from './enums.js';

describe('domain enums', () => {
  it('have unique, snake_case values', () => {
    const lists = Object.entries(enums as Record<string, unknown>).filter(
      (entry): entry is [string, readonly string[]] => Array.isArray(entry[1]),
    );
    expect(lists.length).toBeGreaterThanOrEqual(16);
    for (const [name, values] of lists) {
      expect(new Set(values).size, name).toBe(values.length);
      for (const value of values) expect(value, name).toMatch(/^[a-z][a-z_]*$/);
    }
  });

  it('cover every state of the notification state machine (§7.7)', () => {
    expect(enums.NOTIFICATION_STATUSES).toEqual([
      'draft',
      'queued',
      'pending_approval',
      'scheduled',
      'sending',
      'sent',
      'partially_sent',
      'failed',
      'canceled',
    ]);
  });

  it('match the role model of §6.1 (V1-22)', () => {
    expect(enums.PLATFORM_ROLES).toEqual(['master', 'none']);
    expect(enums.ORG_ROLES).toEqual(['org_admin', 'member']);
    expect(enums.APP_ROLES).toEqual(['admin', 'operator', 'viewer']);
  });
});
