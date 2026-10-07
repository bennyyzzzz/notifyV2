import { CryptoError } from './errors.js';

export const MIN_SECRET_BYTES = 32;

/**
 * Shannon entropy in bits per byte. Random 32-byte keys land around 4.5–5;
 * repeated or ASCII-phrase material lands well below the threshold.
 */
export function shannonEntropyPerByte(data: Uint8Array): number {
  if (data.length === 0) return 0;
  const counts = new Map<number, number>();
  for (const byte of data) counts.set(byte, (counts.get(byte) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / data.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function looksLikePrintableText(data: Uint8Array): boolean {
  for (const byte of data) {
    if (byte < 0x20 || byte > 0x7e) return false;
  }
  return true;
}

/**
 * Rejects key material that is too short or obviously not random (e.g. "minha-chave-secreta..." from v1, V1-08/V1-09).
 */
export function assertStrongKeyMaterial(material: Uint8Array, name: string): void {
  if (material.length < MIN_SECRET_BYTES) {
    throw new CryptoError('WEAK_SECRET', `${name} must have at least ${MIN_SECRET_BYTES} bytes`);
  }
  // A uniformly random 32-byte buffer is printable ASCII with probability ~(95/256)^32 ≈ 1e-14.
  if (looksLikePrintableText(material)) {
    throw new CryptoError('WEAK_SECRET', `${name} looks like a passphrase; generate random bytes instead`);
  }
  if (shannonEntropyPerByte(material) < 4) {
    throw new CryptoError('WEAK_SECRET', `${name} has too little entropy`);
  }
}
