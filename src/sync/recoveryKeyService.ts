/**
 * LIFTED — Recovery Key & AEK Escrow Cryptographic Service
 * Phase 8 Stage 2: Canonical Recovery Code, HKDF/PBKDF2 Derivation & Authenticated AEK Wrapping
 *
 * Mathematical Invariants:
 * 1. Entropy: 128 bits (16 bytes) uniform cryptographic random via WebCrypto getRandomValues.
 * 2. Checksum: 16 bits (2 bytes) SHA-256 digest prefix over the 16 entropy bytes.
 * 3. Total Payload: 18 bytes = 144 bits.
 * 4. Crockford Base32: 144 bits / 5 bits per symbol = 28.8 -> EXACTLY 29 symbols.
 *    - 28 symbols encode 140 bits.
 *    - The 29th symbol encodes the final 4 bits plus 1 zero padding bit: (val << 1) & 0x1F.
 * 5. Display Format: LIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXXX (6 chunks of 4 + 1 chunk of 5).
 * 6. Perfectly Reciprocal: Formatter and parser are exact inverses with homoglyph normalization.
 * 7. Key Derivation:
 *    - HKDF-SHA-256 (RFC 5869) by default for sub-millisecond execution on 128-bit high-entropy secret.
 *    - PBKDF2-HMAC-SHA256 (600,000 iterations) supported for password-stretched compatibility.
 * 8. Authenticated Encryption: AES-256-GCM wrapping with bound Associated Authenticated Data (AAD).
 */

import { TamperedCiphertextError } from '../storage/errors';
import type { RecoveryKeyValidationResult, WrappedAekEnvelope, AekAssociatedData } from './types';

export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CANONICAL_RECOVERY_CODE_LENGTH = 29; // Exactly 29 Crockford Base32 symbols
export const PBKDF2_ITERATIONS = 600000;
export const DOMAIN_SEPARATION_TAG = 'LIFTED-AEK-ESCROW-v1';

export class RecoveryKeyService {
  private crypto: Crypto;

  constructor(customCrypto?: Crypto) {
    this.crypto = customCrypto || globalThis.crypto;
  }

  /**
   * Encodes exactly 18 bytes (144 bits) into exactly 29 Crockford Base32 characters
   * with 1 bit of trailing zero-padding.
   */
  encodeCanonicalBase32(bytes: Uint8Array): string {
    if (bytes.length !== 18) {
      throw new Error(`Invalid byte length for canonical recovery code: expected 18 bytes (144 bits), received ${bytes.length}.`);
    }

    let bits = 0;
    let value = 0;
    let output = '';

    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;

      while (bits >= 5) {
        output += CROCKFORD_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }

    // Exactly 4 bits remaining after 28 symbols (144 - 140 = 4)
    if (bits > 0) {
      output += CROCKFORD_ALPHABET[(value << (5 - bits)) & 31];
    }

    if (output.length !== CANONICAL_RECOVERY_CODE_LENGTH) {
      throw new Error(`Invariant violation: Base32 encoding produced ${output.length} characters; expected ${CANONICAL_RECOVERY_CODE_LENGTH}.`);
    }

    return output;
  }

  /**
   * Decodes exactly 29 Crockford Base32 characters into exactly 18 bytes (144 bits)
   * while verifying that the trailing padding bit is zero.
   */
  decodeCanonicalBase32(str: string): Uint8Array {
    if (str.length !== CANONICAL_RECOVERY_CODE_LENGTH) {
      throw new Error(`Invalid Crockford Base32 length: expected ${CANONICAL_RECOVERY_CODE_LENGTH} characters, received ${str.length}.`);
    }

    let bits = 0;
    let value = 0;
    const bytes: number[] = [];

    for (let i = 0; i < str.length; i++) {
      const char = str[i];
      const idx = CROCKFORD_ALPHABET.indexOf(char);
      if (idx === -1) {
        throw new Error(`Invalid Crockford Base32 character '${char}' at position ${i}.`);
      }

      value = (value << 5) | idx;
      bits += 5;

      if (bits >= 8) {
        bytes.push((value >>> (bits - 8)) & 255);
        bits -= 8;
      }
    }

    // 29 symbols * 5 = 145 bits. 18 bytes * 8 = 144 bits. Exactly 1 padding bit remains.
    if (bits !== 1) {
      throw new Error(`Bit buffer mismatch: expected 1 remaining padding bit, received ${bits}.`);
    }

    // Invariant: The padding bit must be zero
    if ((value & 1) !== 0) {
      throw new Error('Invalid padding bit: trailing bit is non-zero.');
    }

    if (bytes.length !== 18) {
      throw new Error(`Decoding failed: expected 18 bytes, received ${bytes.length}.`);
    }

    return new Uint8Array(bytes);
  }

  /**
   * Computes a 2-byte (16-bit) SHA-256 checksum over raw entropy bytes
   */
  async computeChecksum(entropy: Uint8Array): Promise<Uint8Array> {
    const hash = await this.crypto.subtle.digest('SHA-256', entropy as unknown as BufferSource);
    return new Uint8Array(hash.slice(0, 2));
  }

  /**
   * Formats 29 Crockford Base32 characters into canonical human-readable chunks:
   * LIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXXX
   */
  formatRecoveryCode(base32Code: string): string {
    if (base32Code.length !== CANONICAL_RECOVERY_CODE_LENGTH) {
      throw new Error(`Cannot format recovery code: expected ${CANONICAL_RECOVERY_CODE_LENGTH} symbols, received ${base32Code.length}.`);
    }

    const chunks = [
      base32Code.slice(0, 4),
      base32Code.slice(4, 8),
      base32Code.slice(8, 12),
      base32Code.slice(12, 16),
      base32Code.slice(16, 20),
      base32Code.slice(20, 24),
      base32Code.slice(24, 29),
    ];

    return `LIFT-${chunks.join('-')}`;
  }

  /**
   * Generates a 128-bit high-entropy Recovery Code with 16-bit SHA-256 checksum.
   * Canonical format: LIFT-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXXX (29 Base32 symbols)
   */
  async generateRecoveryCode(): Promise<{ code: string; rawEntropy: Uint8Array }> {
    const rawEntropy = new Uint8Array(16);
    this.crypto.getRandomValues(rawEntropy);

    const checksum = await this.computeChecksum(rawEntropy);
    const combined = new Uint8Array(18);
    combined.set(rawEntropy, 0);
    combined.set(checksum, 16);

    const base32 = this.encodeCanonicalBase32(combined);
    const code = this.formatRecoveryCode(base32);

    return { code, rawEntropy };
  }

  /**
   * Normalizes and validates a recovery code against its embedded SHA-256 checksum.
   * Handles:
   * - Whitespace and hyphen stripping
   * - 'LIFT-' or 'LIFT' prefix removal
   * - Case insensitivity
   * - Homoglyphs: 'O'/'o' -> '0', 'I'/'i'/'L'/'l' -> '1'
   * - Strict 29-symbol length check
   * - 16-bit checksum verification
   */
  async validateRecoveryCode(inputCode: string): Promise<RecoveryKeyValidationResult> {
    try {
      if (!inputCode || typeof inputCode !== 'string') {
        return { valid: false, error: 'Recovery code must be a non-empty string.' };
      }

      // 1. Strip spaces, hyphens, and normalize case
      let cleaned = inputCode.trim().toUpperCase().replace(/[\s-]/g, '');

      // 2. Remove LIFT prefix if present
      if (cleaned.startsWith('LIFT')) {
        cleaned = cleaned.slice(4);
      }

      // 3. Normalize homoglyphs
      cleaned = cleaned.replace(/O/g, '0').replace(/[IL]/g, '1');

      // 4. Strict length check: MUST be exactly 29 Crockford Base32 characters
      if (cleaned.length !== CANONICAL_RECOVERY_CODE_LENGTH) {
        return {
          valid: false,
          error: `Invalid recovery code length: expected exactly ${CANONICAL_RECOVERY_CODE_LENGTH} symbols, received ${cleaned.length}.`,
        };
      }

      // 5. Decode Crockford Base32 and verify padding bit
      const decoded = this.decodeCanonicalBase32(cleaned);
      const entropy = decoded.slice(0, 16);
      const embeddedChecksum = decoded.slice(16, 18);

      // 6. Verify SHA-256 checksum
      const calculatedChecksum = await this.computeChecksum(entropy);
      if (
        embeddedChecksum[0] !== calculatedChecksum[0] ||
        embeddedChecksum[1] !== calculatedChecksum[1]
      ) {
        return {
          valid: false,
          error: 'Checksum verification failed: one or more characters were entered incorrectly.',
        };
      }

      const hex = Array.from(entropy).map((b) => b.toString(16).padStart(2, '0')).join('');
      const csumHex = Array.from(embeddedChecksum).map((b) => b.toString(16).padStart(2, '0')).join('');

      return {
        valid: true,
        formattedCode: this.formatRecoveryCode(cleaned),
        rawEntropyHex: hex,
        checksumHex: csumHex,
      };
    } catch (err: unknown) {
      return {
        valid: false,
        error: err instanceof Error ? err.message : 'Invalid recovery code format.',
      };
    }
  }

  /**
   * Derives a 256-bit AES-GCM wrapping key via HKDF-SHA-256 (RFC 5869)
   * Optimal for 128-bit uniform cryptographic entropy: sub-millisecond execution, zero UI lag.
   */
  async deriveWrappingKeyHKDF(
    rawEntropy: Uint8Array,
    salt: Uint8Array,
    infoString: string = 'LIFTED-AEK-ESCROW-HKDF-v1'
  ): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyMaterial = await this.crypto.subtle.importKey(
      'raw',
      rawEntropy as unknown as BufferSource,
      'HKDF',
      false,
      ['deriveKey']
    );

    return this.crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: salt as unknown as BufferSource,
        info: encoder.encode(infoString) as unknown as BufferSource,
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Derives a 256-bit AES-GCM wrapping key via PBKDF2-HMAC-SHA256 (600,000 iterations)
   * Rationale: Password-stretching KDF designed for low-entropy passwords.
   * Runtime cost: ~200-500ms on desktop; up to 1-2s on mobile devices.
   */
  async deriveWrappingKeyPBKDF2(rawEntropy: Uint8Array, salt: Uint8Array): Promise<CryptoKey> {
    const keyMaterial = await this.crypto.subtle.importKey(
      'raw',
      rawEntropy as unknown as BufferSource,
      'PBKDF2',
      false,
      ['deriveKey']
    );

    return this.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt as unknown as BufferSource,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Default wrapping key derivation (HKDF by default for instant, sub-millisecond execution)
   */
  async deriveWrappingKey(
    rawEntropy: Uint8Array,
    salt: Uint8Array,
    kdf: 'HKDF' | 'PBKDF2' = 'HKDF'
  ): Promise<CryptoKey> {
    if (kdf === 'PBKDF2') {
      return this.deriveWrappingKeyPBKDF2(rawEntropy, salt);
    }
    return this.deriveWrappingKeyHKDF(rawEntropy, salt);
  }

  /**
   * Generates a 256-bit Account Encryption Key (AEK)
   */
  async generateAEK(): Promise<CryptoKey> {
    return this.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      true, // Must be extractable for wrapping
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Wraps an AEK with a derived Wrapping Key, binding Associated Authenticated Data (AAD)
   */
  async wrapAEK(
    aek: CryptoKey,
    wrappingKey: CryptoKey,
    aadData: AekAssociatedData,
    saltOrKdf?: Uint8Array | 'HKDF-SHA256' | 'PBKDF2-SHA256',
    kdfAlgorithm: 'HKDF-SHA256' | 'PBKDF2-SHA256' = 'HKDF-SHA256'
  ): Promise<WrappedAekEnvelope> {
    const rawAek = await this.crypto.subtle.exportKey('raw', aek);
    let salt: Uint8Array;
    let kdf: 'HKDF-SHA256' | 'PBKDF2-SHA256' = kdfAlgorithm;

    if (saltOrKdf instanceof Uint8Array) {
      salt = saltOrKdf;
    } else {
      if (typeof saltOrKdf === 'string') {
        kdf = saltOrKdf;
      }
      const randomSalt = new Uint8Array(32);
      this.crypto.getRandomValues(randomSalt);
      salt = randomSalt;
    }

    const iv = new Uint8Array(12);
    this.crypto.getRandomValues(iv);

    const encoder = new TextEncoder();
    const aadBytes = encoder.encode(
      `${DOMAIN_SEPARATION_TAG}:${aadData.userId}:${aadData.keyVersion}:${aadData.domain}`
    );

    const ciphertextBuffer = await this.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: iv as unknown as BufferSource,
        additionalData: aadBytes as unknown as BufferSource,
      },
      wrappingKey,
      rawAek
    );

    const ctArray = new Uint8Array(ciphertextBuffer);
    let ctBinary = '';
    for (let i = 0; i < ctArray.length; i++) ctBinary += String.fromCharCode(ctArray[i]);

    let ivBinary = '';
    for (let i = 0; i < iv.length; i++) ivBinary += String.fromCharCode(iv[i]);

    let saltBinary = '';
    for (let i = 0; i < salt.length; i++) saltBinary += String.fromCharCode(salt[i]);

    return {
      v: 1,
      alg: 'AES-GCM-256',
      kdf,
      salt: btoa(saltBinary),
      iv: btoa(ivBinary),
      ct: btoa(ctBinary),
      aad: aadData,
      iterations: kdf === 'PBKDF2-SHA256' ? PBKDF2_ITERATIONS : undefined,
    };
  }

  /**
   * Unwraps and verifies an AEK using the derived Wrapping Key and verifies AAD binding
   */
  async unwrapAEK(
    envelope: WrappedAekEnvelope,
    wrappingKey: CryptoKey,
    expectedAad: AekAssociatedData
  ): Promise<CryptoKey> {
    if (envelope.v !== 1) {
      throw new Error('Unsupported wrapped AEK envelope version.');
    }

    // Verify AAD parameters match expected values
    if (
      envelope.aad.userId !== expectedAad.userId ||
      envelope.aad.keyVersion !== expectedAad.keyVersion ||
      envelope.aad.domain !== expectedAad.domain
    ) {
      throw new TamperedCiphertextError('Associated Authenticated Data mismatch: potential account substitution.');
    }

    const encoder = new TextEncoder();
    const aadBytes = encoder.encode(
      `${DOMAIN_SEPARATION_TAG}:${expectedAad.userId}:${expectedAad.keyVersion}:${expectedAad.domain}`
    );

    const ivBinary = atob(envelope.iv);
    const iv = new Uint8Array(ivBinary.length);
    for (let i = 0; i < ivBinary.length; i++) iv[i] = ivBinary.charCodeAt(i);

    const ctBinary = atob(envelope.ct);
    const ct = new Uint8Array(ctBinary.length);
    for (let i = 0; i < ctBinary.length; i++) ct[i] = ctBinary.charCodeAt(i);

    try {
      const rawAekBuffer = await this.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: iv as unknown as BufferSource,
          additionalData: aadBytes as unknown as BufferSource,
        },
        wrappingKey,
        ct as unknown as BufferSource
      );

      return this.crypto.subtle.importKey(
        'raw',
        rawAekBuffer,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
      );
    } catch {
      throw new TamperedCiphertextError('AEK unwrapping failed: invalid recovery key, corrupted ciphertext, or tampered AAD.');
    }
  }

  /**
   * Safely unpacks a bootstrap envelope received from the get_recovery_bootstrap_envelope RPC.
   * Validates structure and returns the WrappedAekEnvelope, or null if not found or invalid.
   */
  parseBootstrapEnvelope(data: unknown): WrappedAekEnvelope | null {
    if (!data || typeof data !== 'object') return null;
    const rec = data as Record<string, unknown>;
    if (rec.status !== 'FOUND' || !rec.wrapped_aek || typeof rec.wrapped_aek !== 'object') {
      return null;
    }
    const env = rec.wrapped_aek as WrappedAekEnvelope;
    if (env.v !== 1 || !env.ct || !env.iv || !env.salt || !env.aad) {
      return null;
    }
    return env;
  }

  /**
   * Performance Benchmark: Compares derivation time of HKDF vs PBKDF2
   */
  async compareKdfPerformance(rawEntropy: Uint8Array): Promise<{ hkdfMs: number; pbkdf2Ms: number }> {
    const salt = new Uint8Array(32);
    this.crypto.getRandomValues(salt);

    const t0 = performance.now();
    await this.deriveWrappingKeyHKDF(rawEntropy, salt);
    const hkdfMs = performance.now() - t0;

    const t1 = performance.now();
    await this.deriveWrappingKeyPBKDF2(rawEntropy, salt);
    const pbkdf2Ms = performance.now() - t1;

    return { hkdfMs, pbkdf2Ms };
  }
}
