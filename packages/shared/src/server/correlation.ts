import { randomUUID } from 'node:crypto';

const INBOUND_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

/**
 * Accepts an inbound correlation id only if it is short and safe to log (prevents log injection);
 * otherwise generates a new UUID.
 */
export function resolveCorrelationId(inbound: string | string[] | undefined): string {
  const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
  if (candidate !== undefined && INBOUND_ID_PATTERN.test(candidate)) return candidate;
  return randomUUID();
}
