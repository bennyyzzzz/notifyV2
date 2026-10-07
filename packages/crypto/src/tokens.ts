import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { CryptoError } from './errors.js';

const TOKEN_PREFIX_PATTERN = /^[a-z]{2,8}_(live|test)_$|^[a-z]{2,8}_$/;

/**
 * Generates an opaque, URL-safe token (refresh, invite, reset, server keys).
 * Only {@link hashToken} of the value is ever stored.
 */
export function generateOpaqueToken(options: { bytes?: number; prefix?: string } = {}): string {
  const bytes = options.bytes ?? 32;
  if (bytes < 16 || bytes > 128) {
    throw new CryptoError('INVALID_INPUT', 'Token size must be between 16 and 128 bytes');
  }
  const prefix = options.prefix ?? '';
  if (prefix !== '' && !TOKEN_PREFIX_PATTERN.test(prefix)) {
    throw new CryptoError('INVALID_INPUT', 'Invalid token prefix');
  }
  return `${prefix}${randomBytes(bytes).toString('base64url')}`;
}

/**
 * Deterministic keyed hash (HMAC-SHA256 with a server-side pepper) used for lookups of
 * high-entropy tokens. Not suitable for passwords — those use argon2id.
 */
export function hashToken(token: string, pepper: Buffer): string {
  if (pepper.length < 32) {
    throw new CryptoError('WEAK_SECRET', 'Pepper must have at least 32 bytes');
  }
  return createHmac('sha256', pepper).update(token, 'utf8').digest('hex');
}

/** Constant-time comparison for hex/base64 digests of equal semantic type. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) {
    // Still burn comparable time to avoid leaking the length mismatch through timing.
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}
