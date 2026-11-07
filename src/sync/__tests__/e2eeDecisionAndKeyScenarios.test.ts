/**
 * LIFTED — E2EE Decision, Key Lifecycle & Envelope Scenarios Test Suite
 * Phase 8 Stage 1: Cryptographic Invariants & Cross-Device Limitation Proofs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { WebCryptoEncryptionService } from '../../storage/encryptionService';
import { TamperedCiphertextError } from '../../storage/errors';
import type { EncryptedPayload } from '../../storage/types';

describe('E2EE Decision & Key Scenarios', () => {
  let encryption: WebCryptoEncryptionService;

  beforeEach(() => {
    encryption = new WebCryptoEncryptionService();
  });

  it('1. Cross-Device Limitation Proof: Device 1 DEK cannot decrypt ciphertext on Device 2 without shared Account Key', async () => {
    // Device 1 generates its independent hardware-backed local DEK
    const device1DEK = await encryption.generateKey(true);
    // Device 2 generates its own independent local DEK
    const device2DEK = await encryption.generateKey(true);

    const sacredPrayer = 'Lord, bring peace to my home and heal my trauma.';
    const device1Ciphertext = await encryption.encryptString(sacredPrayer, device1DEK);

    // Device 1 decrypts cleanly
    const decryptedDevice1 = await encryption.decryptString(device1Ciphertext, device1DEK);
    expect(decryptedDevice1).toBe(sacredPrayer);

    // Device 2 tries to decrypt Device 1 ciphertext using its local DEK:
    // Invariant: FAILS with TamperedCiphertextError because DEK is device-isolated!
    await expect(
      encryption.decryptString(device1Ciphertext, device2DEK)
    ).rejects.toThrow(TamperedCiphertextError);
  });

  it('2. Ciphertext Tamper Defense: Corrupting a single byte in ciphertext causes AES-GCM tag verification failure', async () => {
    const key = await encryption.generateKey(true);
    const originalText = 'Private journal entry expressing deep sorrow and hope.';
    const payload = await encryption.encryptString(originalText, key);

    // Tamper with base64 ciphertext
    const tamperedCt = payload.ct.slice(0, -4) + 'AAAA';
    const tamperedPayload: EncryptedPayload = {
      ...payload,
      ct: tamperedCt,
    };

    await expect(
      encryption.decryptString(tamperedPayload, key)
    ).rejects.toThrow(TamperedCiphertextError);
  });

  it('3. Unsupported Envelope Version Rejection: Refuses to process envelopes with unsupported version', async () => {
    const key = await encryption.generateKey(true);
    const payload = await encryption.encryptString('Test note', key);

    // Unsupported version v: 2 (future unmigrated version)
    const futurePayload = {
      ...payload,
      v: 2,
    } as unknown as EncryptedPayload;

    await expect(
      encryption.decryptString(futurePayload, key)
    ).rejects.toThrow('Invalid payload envelope format.');
  });

  it('4. Zero Plaintext Invariant: Encrypted envelope ct never contains raw sensitive keywords', async () => {
    const key = await encryption.generateKey(true);
    const confidentialNote = 'CONFIDENTIAL_PASTORAL_COUNSELING_SECRET_DATA';
    const envelope = await encryption.encryptString(confidentialNote, key);

    expect(envelope.ct).not.toContain('CONFIDENTIAL');
    expect(envelope.ct).not.toContain('PASTORAL');
    expect(envelope.ct).not.toContain('COUNSELING');
    expect(envelope.ct).not.toContain('SECRET');
    expect(envelope.iv).toHaveLength(16); // 12 bytes base64-encoded is 16 chars
  });

  it('5. Account Encryption Key (AEK) Wrapping Pattern: Demonstrates safe wrapping with high-entropy recovery key', async () => {
    // 1. Account Encryption Key (AEK) generated for user's multi-device domain
    const aek = await encryption.generateKey(true);
    const aekRaw = await encryption.exportRawKey(aek);

    // 2. High-entropy 256-bit recovery key (e.g. 24-word or hex secret held by user)
    const recoveryKey = await encryption.generateKey(true);

    // 3. Wrap AEK with Recovery Key
    let aekBinary = '';
    for (let i = 0; i < aekRaw.length; i++) {
      aekBinary += String.fromCharCode(aekRaw[i]);
    }
    const aekBase64 = btoa(aekBinary);
    const wrappedAekEnvelope = await encryption.encryptString(aekBase64, recoveryKey);

    // 4. Unwrap AEK on a new second device using the Recovery Key
    const unwrappedAekBase64 = await encryption.decryptString(wrappedAekEnvelope, recoveryKey);
    const unwrappedBinary = atob(unwrappedAekBase64);
    const unwrappedAekBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      unwrappedAekBytes[i] = unwrappedBinary.charCodeAt(i);
    }
    const restoredAek = await encryption.importRawKey(unwrappedAekBytes, true);

    // 5. Test encrypt on Device 1 with AEK, decrypt on Device 2 with restored AEK
    const testSecret = 'Cross-device encrypted devotional journal';
    const encryptedWithAek = await encryption.encryptString(testSecret, aek);
    const decryptedOnDevice2 = await encryption.decryptString(encryptedWithAek, restoredAek);

    expect(decryptedOnDevice2).toBe(testSecret);
  });
});
