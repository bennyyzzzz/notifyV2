import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { assertStrongKeyMaterial, shannonEntropyPerByte } from './entropy.js';
import { generateOpaqueToken, hashToken, safeEqual } from './tokens.js';

const pepper = randomBytes(32);

describe('opaque tokens', () => {
  it('generates unique url-safe tokens with optional prefix', () => {
    const a = generateOpaqueToken({ prefix: 'sk_live_' });
    const b = generateOpaqueToken({ prefix: 'sk_live_' });
    expect(a).toMatch(/^sk_live_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(generateOpaqueToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('validates size and prefix', () => {
    expect(() => generateOpaqueToken({ bytes: 8 })).toThrow();
    expect(() => generateOpaqueToken({ bytes: 256 })).toThrow();
    expect(() => generateOpaqueToken({ prefix: '<script>' })).toThrow();
  });

  it('hashes deterministically with a pepper and never returns the token', () => {
    const token = generateOpaqueToken();
    const hash = hashToken(token, pepper);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).toBe(hashToken(token, pepper));
    expect(hash).not.toBe(hashToken(token, randomBytes(32)));
    expect(() => hashToken(token, Buffer.alloc(8))).toThrow();
  });

  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('secret strength', () => {
  it('accepts random material', () => {
    expect(() => assertStrongKeyMaterial(randomBytes(32), 'X')).not.toThrow();
    expect(shannonEntropyPerByte(new Uint8Array())).toBe(0);
  });

  it('rejects short, text-like or low-entropy material', () => {
    expect(() => assertStrongKeyMaterial(randomBytes(16), 'X')).toThrow(/at least/);
    expect(() => assertStrongKeyMaterial(Buffer.from('uma-chave-jwt-muito-secreta-1234'), 'X')).toThrow(/passphrase/);
    const lowEntropy = Buffer.alloc(32);
    lowEntropy[0] = 1;
    expect(() => assertStrongKeyMaterial(lowEntropy, 'X')).toThrow(/entropy/);
  });
});
