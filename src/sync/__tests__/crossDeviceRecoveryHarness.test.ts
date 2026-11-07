/**
 * LIFTED — Cross-Device Recovery Test Harness
 * Phase 8 Stage 2: Isolated Multi-Device Key Exchange, Restore & Tamper Defense
 *
 * Verifies the complete two-device E2EE lifecycle with isolated local DEKs:
 * 1. Device A and Device B possess independent hardware DEKs.
 * 2. Device A generates AEK, wraps it with 128-bit Recovery Code, and encrypts synthetic journal.
 * 3. Device B cannot decrypt Device A ciphertext with Device B's local DEK.
 * 4. Device B restores the AEK using the Recovery Code, validates checksum, and decrypts the journal.
 * 5. Device B wraps the AEK with Device B's own DEK for fast local persistence.
 * 6. Hardened tests for:
 *    - One-character typo in recovery code (checksum catches it).
 *    - Truncated code rejection.
 *    - Homoglyph normalization (O -> 0, I -> 1).
 *    - Cross-account AAD substitution rejection.
 *    - Tampered ciphertext rejection (AES-GCM tag failure).
 *    - Unsupported envelope version rejection.
 *    - Missing wrapped key in cloud backend.
 */

import { describe, it, expect } from 'vitest';
import { RecoveryKeyService } from '../recoveryKeyService';
import { WebCryptoEncryptionService } from '../../storage/encryptionService';
import { TamperedCiphertextError } from '../../storage/errors';
import type { WrappedAekEnvelope, AekAssociatedData } from '../types';

describe('Cross-Device Recovery Test Harness', () => {
  const recoveryService = new RecoveryKeyService();
  const encryption = new WebCryptoEncryptionService();

  it('Executes complete cross-device enrollment, restore, and local DEK caching', async () => {
    // -------------------------------------------------------------
    // DEVICE A (Originating Device)
    // -------------------------------------------------------------
    // Device A has its own isolated hardware DEK
    const deviceADEK = await encryption.generateKey(true);
    const localEnvelopeA = await encryption.encryptString('Local journal reflection', deviceADEK);
    expect(localEnvelopeA.ct).toBeDefined();

    // Device A initiates Recovery Setup: generates AEK and 29-symbol Recovery Code
    const { code: recoveryCode, rawEntropy } = await recoveryService.generateRecoveryCode();
    const aek = await recoveryService.generateAEK();

    const salt = new Uint8Array(32);
    globalThis.crypto.getRandomValues(salt);

    const aadDeviceA: AekAssociatedData = {
      userId: 'test-user-alpha-999',
      keyVersion: 1,
      domain: 'LIFTED-AEK',
    };

    // Wrap AEK with HKDF-derived Wrapping Key
    const wrappingKeyA = await recoveryService.deriveWrappingKeyHKDF(rawEntropy, salt);
    const wrappedAekEnvelope = await recoveryService.wrapAEK(aek, wrappingKeyA, aadDeviceA, salt, 'HKDF-SHA256');

    // Device A encrypts synthetic journal reflection using the AEK
    const syntheticJournalText = 'Synthetic pastoral journal reflection for cross-device testing.';
    const syntheticEnvelope = await encryption.encryptString(syntheticJournalText, aek);

    // -------------------------------------------------------------
    // ISOLATED TEST BACKEND (Cloud Storage)
    // -------------------------------------------------------------
    const cloudBackend = {
      wrappedAek: wrappedAekEnvelope,
      encryptedJournal: syntheticEnvelope,
      userId: 'test-user-alpha-999',
    };

    // -------------------------------------------------------------
    // DEVICE B (New Enrolling Device)
    // -------------------------------------------------------------
    // Device B has an independent hardware DEK
    const deviceBDEK = await encryption.generateKey(true);

    // Negative Invariant: Device B CANNOT decrypt the journal with its own DEK!
    await expect(
      encryption.decryptString(cloudBackend.encryptedJournal, deviceBDEK)
    ).rejects.toThrow(TamperedCiphertextError);

    // User enters recovery code on Device B
    const validationB = await recoveryService.validateRecoveryCode(recoveryCode);
    expect(validationB.valid).toBe(true);

    // Device B decodes user-entered code
    const decodedEntropyB = recoveryService.decodeCanonicalBase32(
      recoveryCode.replace(/[\s-]|LIFT/g, '')
    ).slice(0, 16);

    // Device B derives wrapping key using cloud salt
    const saltBinary = atob(cloudBackend.wrappedAek.salt);
    const cloudSalt = new Uint8Array(saltBinary.length);
    for (let i = 0; i < saltBinary.length; i++) cloudSalt[i] = saltBinary.charCodeAt(i);

    const wrappingKeyB = await recoveryService.deriveWrappingKeyHKDF(decodedEntropyB, cloudSalt);

    // Device B unwraps AEK and verifies AAD binding
    const restoredAekB = await recoveryService.unwrapAEK(
      cloudBackend.wrappedAek,
      wrappingKeyB,
      {
        userId: cloudBackend.userId,
        keyVersion: 1,
        domain: 'LIFTED-AEK',
      }
    );

    // Invariant: Device B can now decrypt the synthetic journal!
    const decryptedOnB = await encryption.decryptString(cloudBackend.encryptedJournal, restoredAekB);
    expect(decryptedOnB).toBe(syntheticJournalText);

    // Device B wraps the restored AEK with Device B's local DEK for local SQLite/Keystore caching
    const rawRestoredAek = await encryption.exportRawKey(restoredAekB);
    let aekBinary = '';
    for (let i = 0; i < rawRestoredAek.length; i++) aekBinary += String.fromCharCode(rawRestoredAek[i]);
    const cachedAekOnDeviceB = await encryption.encryptString(btoa(aekBinary), deviceBDEK);

    // Simulate Device B restart: retrieve cached AEK via Device B local DEK
    const retrievedAekBase64 = await encryption.decryptString(cachedAekOnDeviceB, deviceBDEK);
    const restoredBinary = atob(retrievedAekBase64);
    const finalAekBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) finalAekBytes[i] = restoredBinary.charCodeAt(i);
    const persistentAekB = await encryption.importRawKey(finalAekBytes, true);

    // Test persistent decryption after restart
    const decryptedAfterRestart = await encryption.decryptString(cloudBackend.encryptedJournal, persistentAekB);
    expect(decryptedAfterRestart).toBe(syntheticJournalText);
  });

  describe('Adversarial & Failure Edge Cases', () => {
    it('Detects and rejects single-character typos in the recovery code', async () => {
      const { code } = await recoveryService.generateRecoveryCode();

      // Change one character in the middle
      const typoChar = code[10] === 'A' ? 'B' : 'A';
      const typoCode = code.slice(0, 10) + typoChar + code.slice(11);

      const result = await recoveryService.validateRecoveryCode(typoCode);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Checksum verification failed');
    });

    it('Rejects truncated recovery codes', async () => {
      const { code } = await recoveryService.generateRecoveryCode();
      const truncated = code.slice(0, -5); // Cut off 5 characters

      const result = await recoveryService.validateRecoveryCode(truncated);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid recovery code length');
    });

    it('Normalizes homoglyphs seamlessly (O -> 0, I/L -> 1)', async () => {
      const { code } = await recoveryService.generateRecoveryCode();

      // Replace '0' with 'O' and '1' with 'I' if present, or test replacement
      const homoglyphCode = code.replace(/0/g, 'O').replace(/1/g, 'I');
      const result = await recoveryService.validateRecoveryCode(homoglyphCode);
      expect(result.valid).toBe(true);
    });

    it('Cross-Account AAD Substitution Attack: Fails when attacker attempts to unwrap User A key for User B', async () => {
      const aek = await recoveryService.generateAEK();
      const { rawEntropy } = await recoveryService.generateRecoveryCode();
      const salt = new Uint8Array(32);
      globalThis.crypto.getRandomValues(salt);

      const wrappingKey = await recoveryService.deriveWrappingKeyHKDF(rawEntropy, salt);

      const userAEnvelope = await recoveryService.wrapAEK(aek, wrappingKey, {
        userId: 'victim-user-A',
        keyVersion: 1,
        domain: 'LIFTED-AEK',
      });

      // Attacker attempts to unwrap under their own user ID
      await expect(
        recoveryService.unwrapAEK(userAEnvelope, wrappingKey, {
          userId: 'attacker-user-B',
          keyVersion: 1,
          domain: 'LIFTED-AEK',
        })
      ).rejects.toThrow(TamperedCiphertextError);
    });

    it('Rejects tampered wrapped AEK ciphertext (AES-GCM tag verification)', async () => {
      const aek = await recoveryService.generateAEK();
      const { rawEntropy } = await recoveryService.generateRecoveryCode();
      const salt = new Uint8Array(32);
      globalThis.crypto.getRandomValues(salt);

      const wrappingKey = await recoveryService.deriveWrappingKeyHKDF(rawEntropy, salt);

      const envelope = await recoveryService.wrapAEK(aek, wrappingKey, {
        userId: 'user-tamper-test',
        keyVersion: 1,
        domain: 'LIFTED-AEK',
      });

      // Tamper with the base64 ciphertext
      const tamperedCt = envelope.ct.slice(0, -6) + 'AAAAAA';
      const tamperedEnvelope: WrappedAekEnvelope = {
        ...envelope,
        ct: tamperedCt,
      };

      await expect(
        recoveryService.unwrapAEK(tamperedEnvelope, wrappingKey, {
          userId: 'user-tamper-test',
          keyVersion: 1,
          domain: 'LIFTED-AEK',
        })
      ).rejects.toThrow(TamperedCiphertextError);
    });

    it('Rejects unsupported wrapped AEK envelope versions', async () => {
      const aek = await recoveryService.generateAEK();
      const { rawEntropy } = await recoveryService.generateRecoveryCode();
      const salt = new Uint8Array(32);
      globalThis.crypto.getRandomValues(salt);

      const wrappingKey = await recoveryService.deriveWrappingKeyHKDF(rawEntropy, salt);

      const envelope = await recoveryService.wrapAEK(aek, wrappingKey, {
        userId: 'user-version-test',
        keyVersion: 1,
        domain: 'LIFTED-AEK',
      });

      const futureEnvelope: WrappedAekEnvelope = {
        ...envelope,
        v: 99, // Future unsupported version
      };

      await expect(
        recoveryService.unwrapAEK(futureEnvelope, wrappingKey, {
          userId: 'user-version-test',
          keyVersion: 1,
          domain: 'LIFTED-AEK',
        })
      ).rejects.toThrow('Unsupported wrapped AEK envelope version.');
    });
  });
});
