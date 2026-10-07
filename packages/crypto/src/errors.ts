export type CryptoErrorCode =
  | 'KEYRING_EMPTY'
  | 'KEYRING_MALFORMED'
  | 'KEYRING_ACTIVE_MISSING'
  | 'KEY_NOT_FOUND'
  | 'WEAK_SECRET'
  | 'DECRYPTION_FAILED'
  | 'INVALID_INPUT';

/** Error messages never include key material or plaintext. */
export class CryptoError extends Error {
  readonly code: CryptoErrorCode;

  constructor(code: CryptoErrorCode, message: string) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
  }
}
