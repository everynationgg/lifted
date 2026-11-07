import type { EncryptedPayload } from './types';
import { TamperedCiphertextError } from './errors';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH_BYTES = 12; // 96-bit IV recommended by NIST for AES-GCM
const CANARY_SECRET = 'LIFTED_SECURITY_CANARY_V1_INTEGRITY_CHECK';

/**
 * Base64 helper utilities for browser and runtime compatibility
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export interface IEncryptionService {
  generateKey(extractable?: boolean): Promise<CryptoKey>;
  importRawKey(rawBytes: Uint8Array, extractable?: boolean): Promise<CryptoKey>;
  exportRawKey(key: CryptoKey): Promise<Uint8Array>;
  encryptString(plaintext: string, key: CryptoKey): Promise<EncryptedPayload>;
  decryptString(payload: EncryptedPayload, key: CryptoKey): Promise<string>;
  createCanaryPayload(key: CryptoKey): Promise<EncryptedPayload>;
  verifyCanaryPayload(payload: EncryptedPayload, key: CryptoKey): Promise<boolean>;
}

export class WebCryptoEncryptionService implements IEncryptionService {
  private crypto: SubtleCrypto;

  constructor(subtleCrypto?: SubtleCrypto) {
    if (subtleCrypto) {
      this.crypto = subtleCrypto;
    } else if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
      this.crypto = window.crypto.subtle;
    } else {
      throw new Error('WebCrypto API (crypto.subtle) is not supported in this runtime environment.');
    }
  }

  /**
   * Generates a 256-bit AES-GCM key using cryptographically secure random values.
   */
  async generateKey(extractable: boolean = false): Promise<CryptoKey> {
    return this.crypto.generateKey(
      {
        name: ALGORITHM,
        length: KEY_LENGTH,
      },
      extractable,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Imports raw 32 bytes into an AES-GCM CryptoKey.
   */
  async importRawKey(rawBytes: Uint8Array, extractable: boolean = false): Promise<CryptoKey> {
    if (rawBytes.byteLength !== 32) {
      throw new Error(`Invalid key length: expected 32 bytes (256-bit), received ${rawBytes.byteLength} bytes.`);
    }
    let keyData = rawBytes as unknown as BufferSource;
    const globalBuffer = (globalThis as unknown as { Buffer?: { from(data: Uint8Array): unknown } }).Buffer;
    if (typeof globalBuffer?.from === 'function') {
      keyData = globalBuffer.from(rawBytes) as unknown as BufferSource;
    }

    return this.crypto.importKey(
      'raw',
      keyData,
      {
        name: ALGORITHM,
        length: KEY_LENGTH,
      },
      extractable,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Exports raw key bytes (available only if key was generated as extractable).
   */
  async exportRawKey(key: CryptoKey): Promise<Uint8Array> {
    const rawBuffer = await this.crypto.exportKey('raw', key);
    return new Uint8Array(rawBuffer);
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a newly generated, unique 96-bit IV.
   * Authentication tag (128-bit) is automatically computed and appended to ciphertext.
   */
  async encryptString(plaintext: string, key: CryptoKey): Promise<EncryptedPayload> {
    const iv = new Uint8Array(IV_LENGTH_BYTES);
    window.crypto.getRandomValues(iv);

    const encoder = new TextEncoder();
    const encoded = encoder.encode(plaintext);

    try {
      const ciphertextBuffer = await this.crypto.encrypt(
        {
          name: ALGORITHM,
          iv,
        },
        key,
        encoded
      );

      return {
        v: 1,
        iv: uint8ArrayToBase64(iv),
        ct: uint8ArrayToBase64(new Uint8Array(ciphertextBuffer)),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Encryption failed';
      throw new Error(`AES-GCM encryption error: ${msg}`);
    }
  }

  /**
   * Decrypts AES-256-GCM payload and verifies the authentication tag.
   * Throws TamperedCiphertextError if the ciphertext was modified, the IV was altered,
   * or the wrong key was provided.
   */
  async decryptString(payload: EncryptedPayload, key: CryptoKey): Promise<string> {
    if (!payload || payload.v !== 1 || !payload.iv || !payload.ct) {
      throw new TamperedCiphertextError('Invalid payload envelope format.');
    }

    try {
      const iv = base64ToUint8Array(payload.iv);
      const ct = base64ToUint8Array(payload.ct);

      const decryptedBuffer = await this.crypto.decrypt(
        {
          name: ALGORITHM,
          iv: iv as unknown as BufferSource,
        },
        key,
        ct as unknown as BufferSource
      );

      const decoder = new TextDecoder();
      return decoder.decode(decryptedBuffer);
    } catch {
      throw new TamperedCiphertextError(
        'Cryptographic verification failed: ciphertext is corrupt, tampered with, or key is invalid.'
      );
    }
  }

  /**
   * Creates a security canary token encrypted with the key.
   * Stored in database metadata to verify key correctness upon reopen.
   */
  async createCanaryPayload(key: CryptoKey): Promise<EncryptedPayload> {
    return this.encryptString(CANARY_SECRET, key);
  }

  /**
   * Verifies an existing security canary token against a key.
   */
  async verifyCanaryPayload(payload: EncryptedPayload, key: CryptoKey): Promise<boolean> {
    try {
      const decrypted = await this.decryptString(payload, key);
      return decrypted === CANARY_SECRET;
    } catch {
      return false;
    }
  }
}

export const encryptionService = new WebCryptoEncryptionService();
