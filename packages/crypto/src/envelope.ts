import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { CryptoError } from './errors.js';
import type { KeyEncryptionProvider } from './keyring.js';

const DEK_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Stored columns: `privateKeyCiphertext`, `dekCiphertext`, `keyId`, `iv`, `authTag`. */
export interface EncryptedEnvelope {
  ciphertext: Buffer;
  dekCiphertext: Buffer;
  keyId: string;
  iv: Buffer;
  authTag: Buffer;
}

/**
 * Encrypts with a fresh per-record DEK (AES-256-GCM) and wraps the DEK with the active KEK.
 *
 * `context` is bound as additional authenticated data (e.g. `firebase_integration:<id>`),
 * so a ciphertext copied to another record fails to decrypt.
 */
export async function encryptEnvelope(
  plaintext: Buffer | string,
  provider: KeyEncryptionProvider,
  context: string,
): Promise<EncryptedEnvelope> {
  assertContext(context);
  const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
  const dek = randomBytes(DEK_BYTES);
  try {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', dek, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(dataAad(context));
    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const { keyId, wrapped } = await provider.wrapKey(dek, context);
    return { ciphertext, dekCiphertext: wrapped, keyId, iv, authTag };
  } finally {
    dek.fill(0);
  }
}

export async function decryptEnvelope(
  envelope: EncryptedEnvelope,
  provider: KeyEncryptionProvider,
  context: string,
): Promise<Buffer> {
  assertContext(context);
  if (envelope.iv.length !== IV_BYTES || envelope.authTag.length !== TAG_BYTES) {
    throw new CryptoError('DECRYPTION_FAILED', 'Envelope has an unexpected format');
  }
  const dek = await provider.unwrapKey(envelope.dekCiphertext, envelope.keyId, context);
  try {
    const decipher = createDecipheriv('aes-256-gcm', dek, envelope.iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(dataAad(context));
    decipher.setAuthTag(envelope.authTag);
    return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]);
  } catch {
    throw new CryptoError('DECRYPTION_FAILED', 'Unable to decrypt envelope');
  } finally {
    dek.fill(0);
  }
}

/**
 * KEK rotation: re-wraps only the DEK with the provider's active key. The data ciphertext is untouched.
 * Returns the same envelope when it already uses the active key.
 */
export async function rewrapEnvelope(
  envelope: EncryptedEnvelope,
  provider: KeyEncryptionProvider,
  context: string,
): Promise<EncryptedEnvelope> {
  assertContext(context);
  if (envelope.keyId === provider.activeKeyId) return envelope;
  const dek = await provider.unwrapKey(envelope.dekCiphertext, envelope.keyId, context);
  try {
    const { keyId, wrapped } = await provider.wrapKey(dek, context);
    return { ...envelope, keyId, dekCiphertext: wrapped };
  } finally {
    dek.fill(0);
  }
}

function dataAad(context: string): Buffer {
  return Buffer.from(`notify:data:v1:${context}`, 'utf8');
}

function assertContext(context: string): void {
  if (context.length === 0 || context.length > 200) {
    throw new CryptoError('INVALID_INPUT', 'Encryption context must be 1-200 characters');
  }
}
