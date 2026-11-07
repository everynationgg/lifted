import { describe, it, expect, beforeEach } from 'vitest';
import { WebCryptoEncryptionService } from '../encryptionService';
import { TamperedCiphertextError } from '../errors';

describe('WebCryptoEncryptionService - AES-256-GCM', () => {
  let encryption: WebCryptoEncryptionService;

  beforeEach(() => {
    encryption = new WebCryptoEncryptionService();
  });

  it('generates a valid AES-GCM CryptoKey', async () => {
    const key = await encryption.generateKey(true);
    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe('AES-GCM');
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it('encrypts and decrypts sensitive reflection text successfully', async () => {
    const key = await encryption.generateKey(false);
    const plaintext = 'Lord, I am carrying deep grief today regarding the loss of my father. Give me your peace.';

    const payload = await encryption.encryptString(plaintext, key);

    expect(payload.v).toBe(1);
    expect(payload.iv).toBeDefined();
    expect(payload.ct).toBeDefined();
    expect(payload.ct).not.toContain('grief'); // Must be ciphertext

    const decrypted = await encryption.decryptString(payload, key);
    expect(decrypted).toBe(plaintext);
  });

  it('handles multi-byte unicode, emojis, and quotes', async () => {
    const key = await encryption.generateKey(false);
    const complexText = '🙏 Peace & Grace! Kamusta ka? "Lord, bind up my wounds." 100% healed. ✨';

    const payload = await encryption.encryptString(complexText, key);
    const decrypted = await encryption.decryptString(payload, key);
    expect(decrypted).toBe(complexText);
  });

  it('generates unique initialization vectors (IVs) for identical plaintexts', async () => {
    const key = await encryption.generateKey(false);
    const text = 'Repeated confidential prayer';

    const p1 = await encryption.encryptString(text, key);
    const p2 = await encryption.encryptString(text, key);

    expect(p1.iv).not.toBe(p2.iv);
    expect(p1.ct).not.toBe(p2.ct);
  });

  it('detects ciphertext tampering and rejects with TamperedCiphertextError', async () => {
    const key = await encryption.generateKey(false);
    const plaintext = 'Original untampered confession';

    const payload = await encryption.encryptString(plaintext, key);

    // Tamper with the base64 ciphertext
    const rawBytes = atob(payload.ct);
    const tamperedBinary = String.fromCharCode(rawBytes.charCodeAt(0) ^ 0xff) + rawBytes.slice(1);
    const tamperedPayload = {
      ...payload,
      ct: btoa(tamperedBinary),
    };

    await expect(encryption.decryptString(tamperedPayload, key)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it('detects IV tampering and rejects with TamperedCiphertextError', async () => {
    const key = await encryption.generateKey(false);
    const payload = await encryption.encryptString('Secret reflection', key);

    const rawIv = atob(payload.iv);
    const tamperedIv = String.fromCharCode(rawIv.charCodeAt(0) ^ 0x01) + rawIv.slice(1);
    const tamperedPayload = {
      ...payload,
      iv: btoa(tamperedIv),
    };

    await expect(encryption.decryptString(tamperedPayload, key)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it('rejects decryption when wrong key is provided', async () => {
    const key1 = await encryption.generateKey(false);
    const key2 = await encryption.generateKey(false);

    const payload = await encryption.encryptString('Encrypted under key 1', key1);

    await expect(encryption.decryptString(payload, key2)).rejects.toThrow(
      TamperedCiphertextError
    );
  });

  it('creates and verifies security canary tokens', async () => {
    const key = await encryption.generateKey(false);
    const canary = await encryption.createCanaryPayload(key);

    const isValid = await encryption.verifyCanaryPayload(canary, key);
    expect(isValid).toBe(true);

    const wrongKey = await encryption.generateKey(false);
    const isInvalid = await encryption.verifyCanaryPayload(canary, wrongKey);
    expect(isInvalid).toBe(false);
  });
});
