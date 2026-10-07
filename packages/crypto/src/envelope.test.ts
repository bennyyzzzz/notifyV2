import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CryptoError } from './errors.js';
import { decryptEnvelope, encryptEnvelope, rewrapEnvelope } from './envelope.js';
import { LocalKeyRing, parseKeyRingSpec } from './keyring.js';

const k1 = randomBytes(32).toString('base64');
const k2 = randomBytes(32).toString('base64');
const ring = LocalKeyRing.fromSpec(`k1:${k1}`, 'k1');
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEv...fake...\n-----END PRIVATE KEY-----\n';
const CONTEXT = 'firebase_integration:0192a5c4-0000-7000-8000-000000000001';

function flipByte(buffer: Buffer, index = 0): Buffer {
  const copy = Buffer.from(buffer);
  copy[index] = (copy[index] ?? 0) ^ 0xff;
  return copy;
}

describe('envelope encryption (AES-256-GCM)', () => {
  it('round-trips plaintext', async () => {
    const envelope = await encryptEnvelope(PEM, ring, CONTEXT);
    expect(envelope.keyId).toBe('k1');
    expect(envelope.iv).toHaveLength(12);
    expect(envelope.authTag).toHaveLength(16);
    expect(envelope.ciphertext.toString('utf8')).not.toContain('PRIVATE KEY');
    const plaintext = await decryptEnvelope(envelope, ring, CONTEXT);
    expect(plaintext.toString('utf8')).toBe(PEM);
  });

  it('uses a fresh IV and DEK per encryption', async () => {
    const a = await encryptEnvelope(PEM, ring, CONTEXT);
    const b = await encryptEnvelope(PEM, ring, CONTEXT);
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.dekCiphertext.equals(b.dekCiphertext)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it.each([
    ['ciphertext', (e: Awaited<ReturnType<typeof encryptEnvelope>>) => ({ ...e, ciphertext: flipByte(e.ciphertext) })],
    ['authTag', (e: Awaited<ReturnType<typeof encryptEnvelope>>) => ({ ...e, authTag: flipByte(e.authTag) })],
    ['iv', (e: Awaited<ReturnType<typeof encryptEnvelope>>) => ({ ...e, iv: flipByte(e.iv) })],
    ['dekCiphertext', (e: Awaited<ReturnType<typeof encryptEnvelope>>) => ({ ...e, dekCiphertext: flipByte(e.dekCiphertext, 20) })],
  ])('detects tampering of %s', async (_field, tamper) => {
    const envelope = await encryptEnvelope(PEM, ring, CONTEXT);
    await expect(decryptEnvelope(tamper(envelope), ring, CONTEXT)).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
  });

  it('binds ciphertext to its context (copy to another record fails)', async () => {
    const envelope = await encryptEnvelope(PEM, ring, CONTEXT);
    await expect(decryptEnvelope(envelope, ring, 'firebase_integration:other')).rejects.toBeInstanceOf(CryptoError);
  });

  it('rejects malformed envelope parts', async () => {
    const envelope = await encryptEnvelope(PEM, ring, CONTEXT);
    await expect(decryptEnvelope({ ...envelope, iv: Buffer.alloc(8) }, ring, CONTEXT)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });
    await expect(
      decryptEnvelope({ ...envelope, dekCiphertext: envelope.dekCiphertext.subarray(1) }, ring, CONTEXT),
    ).rejects.toMatchObject({ code: 'DECRYPTION_FAILED' });
  });

  it('rejects empty or oversized contexts', async () => {
    await expect(encryptEnvelope(PEM, ring, '')).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(encryptEnvelope(PEM, ring, 'x'.repeat(201))).rejects.toMatchObject({ code: 'INVALID_INPUT' });
  });

  it('fails when the key id is unknown', async () => {
    const envelope = await encryptEnvelope(PEM, ring, CONTEXT);
    await expect(decryptEnvelope({ ...envelope, keyId: 'k9' }, ring, CONTEXT)).rejects.toMatchObject({
      code: 'KEY_NOT_FOUND',
    });
  });

  it('rotates the KEK by re-wrapping only the DEK', async () => {
    const envelope = await encryptEnvelope(PEM, ring, CONTEXT);
    const rotated = LocalKeyRing.fromSpec(`k1:${k1},k2:${k2}`, 'k2');
    const rewrapped = await rewrapEnvelope(envelope, rotated, CONTEXT);
    expect(rewrapped.keyId).toBe('k2');
    expect(rewrapped.ciphertext.equals(envelope.ciphertext)).toBe(true);
    expect((await decryptEnvelope(rewrapped, rotated, CONTEXT)).toString('utf8')).toBe(PEM);

    const onlyNew = LocalKeyRing.fromSpec(`k2:${k2}`, 'k2');
    expect((await decryptEnvelope(rewrapped, onlyNew, CONTEXT)).toString('utf8')).toBe(PEM);
    expect(await rewrapEnvelope(rewrapped, rotated, CONTEXT)).toBe(rewrapped);
  });
});

describe('key ring parsing', () => {
  it('parses multiple keys', () => {
    const keys = parseKeyRingSpec(` k1:${k1} , k2:${k2} `);
    expect([...keys.keys()]).toEqual(['k1', 'k2']);
    expect(ring.hasKey('k1')).toBe(true);
    expect(ring.hasKey('k2')).toBe(false);
  });

  it.each([
    ['empty', ''],
    ['missing separator', k1],
    ['bad id', `K1!:${k1}`],
    ['duplicate id', `k1:${k1},k1:${k2}`],
    ['short key', `k1:${randomBytes(16).toString('base64')}`],
    ['non canonical base64', `k1:${k1.replace(/=+$/, '')}!`],
    ['passphrase (v1 style)', `k1:${Buffer.from('minha-chave-secreta-super-forte!').toString('base64')}`],
    ['repeated bytes', `k1:${Buffer.alloc(32, 0xab).toString('base64')}`],
  ])('rejects %s', (_name, spec) => {
    expect(() => parseKeyRingSpec(spec)).toThrow(CryptoError);
  });

  it('requires the active key to exist', () => {
    expect(() => LocalKeyRing.fromSpec(`k1:${k1}`, 'k2')).toThrow(/Active key/);
  });
});
