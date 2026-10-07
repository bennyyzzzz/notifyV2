import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CryptoError } from './errors.js';
import { assertStrongKeyMaterial } from './entropy.js';

const KEY_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const KEK_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const WRAP_FORMAT_VERSION = 1;

/**
 * Wraps and unwraps data-encryption keys (DEKs). Implemented locally by {@link LocalKeyRing};
 * a KMS-backed implementation can be plugged in without touching callers.
 */
export interface KeyEncryptionProvider {
  readonly activeKeyId: string;
  wrapKey(dek: Buffer, context: string): Promise<{ keyId: string; wrapped: Buffer }>;
  unwrapKey(wrapped: Buffer, keyId: string, context: string): Promise<Buffer>;
  hasKey(keyId: string): boolean;
}

/**
 * Parses `ENCRYPTION_KEYS` in the form `keyId:base64,keyId2:base64`.
 * Every key must decode to exactly 32 random-looking bytes; derivation from passphrases is not supported.
 */
export function parseKeyRingSpec(spec: string): Map<string, Buffer> {
  const keys = new Map<string, Buffer>();
  const entries = spec
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  if (entries.length === 0) {
    throw new CryptoError('KEYRING_EMPTY', 'ENCRYPTION_KEYS must contain at least one key');
  }

  for (const entry of entries) {
    const separator = entry.indexOf(':');
    if (separator <= 0) {
      throw new CryptoError('KEYRING_MALFORMED', 'Each ENCRYPTION_KEYS entry must be "keyId:base64"');
    }
    const keyId = entry.slice(0, separator);
    const encoded = entry.slice(separator + 1);
    if (!KEY_ID_PATTERN.test(keyId)) {
      throw new CryptoError('KEYRING_MALFORMED', `Invalid key id "${keyId}"`);
    }
    if (keys.has(keyId)) {
      throw new CryptoError('KEYRING_MALFORMED', `Duplicate key id "${keyId}"`);
    }
    const material = Buffer.from(encoded, 'base64');
    if (material.length !== KEK_BYTES || material.toString('base64') !== encoded) {
      throw new CryptoError('KEYRING_MALFORMED', `Key "${keyId}" must be exactly ${KEK_BYTES} bytes in canonical base64`);
    }
    assertStrongKeyMaterial(material, `ENCRYPTION_KEYS[${keyId}]`);
    keys.set(keyId, material);
  }
  return keys;
}

/** Key-encryption keys held in process memory (from the secret manager via env). */
export class LocalKeyRing implements KeyEncryptionProvider {
  readonly activeKeyId: string;
  readonly #keys: Map<string, Buffer>;

  constructor(keys: Map<string, Buffer>, activeKeyId: string) {
    if (!keys.has(activeKeyId)) {
      throw new CryptoError('KEYRING_ACTIVE_MISSING', `Active key "${activeKeyId}" is not in the key ring`);
    }
    this.#keys = new Map(keys);
    this.activeKeyId = activeKeyId;
  }

  static fromSpec(spec: string, activeKeyId: string): LocalKeyRing {
    return new LocalKeyRing(parseKeyRingSpec(spec), activeKeyId);
  }

  hasKey(keyId: string): boolean {
    return this.#keys.has(keyId);
  }

  async wrapKey(dek: Buffer, context: string): Promise<{ keyId: string; wrapped: Buffer }> {
    const keyId = this.activeKeyId;
    const kek = this.#requireKey(keyId);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', kek, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(wrapAad(keyId, context));
    const ciphertext = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    const wrapped = Buffer.concat([Buffer.from([WRAP_FORMAT_VERSION]), iv, tag, ciphertext]);
    return { keyId, wrapped };
  }

  async unwrapKey(wrapped: Buffer, keyId: string, context: string): Promise<Buffer> {
    const kek = this.#requireKey(keyId);
    if (wrapped.length !== 1 + IV_BYTES + TAG_BYTES + KEK_BYTES || wrapped[0] !== WRAP_FORMAT_VERSION) {
      throw new CryptoError('DECRYPTION_FAILED', 'Wrapped key has an unexpected format');
    }
    const iv = wrapped.subarray(1, 1 + IV_BYTES);
    const tag = wrapped.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
    const ciphertext = wrapped.subarray(1 + IV_BYTES + TAG_BYTES);
    try {
      const decipher = createDecipheriv('aes-256-gcm', kek, iv, { authTagLength: TAG_BYTES });
      decipher.setAAD(wrapAad(keyId, context));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      throw new CryptoError('DECRYPTION_FAILED', 'Unable to unwrap data key');
    }
  }

  #requireKey(keyId: string): Buffer {
    const key = this.#keys.get(keyId);
    if (!key) {
      throw new CryptoError('KEY_NOT_FOUND', `Key "${keyId}" is not available`);
    }
    return key;
  }
}

function wrapAad(keyId: string, context: string): Buffer {
  return Buffer.from(`notify:dek:v1:${keyId}:${context}`, 'utf8');
}
