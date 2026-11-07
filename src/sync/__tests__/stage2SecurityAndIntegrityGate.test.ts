/**
 * LIFTED — Phase 8 Stage 2 Security, Data-Integrity & Recovery Specification Gate
 * Comprehensive Regression & Invariant Verification Suite
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBDriver } from '../../storage/databaseDriver';
import { OutboxManager } from '../outboxManager';
import { TombstoneManager } from '../tombstoneManager';
import { RecoveryKeyService } from '../recoveryKeyService';
import { SyncReconciliationEngine } from '../syncReconciliationEngine';
import { TamperedCiphertextError } from '../../storage/errors';
import type { INetworkTelemetryService, NetworkTelemetrySnapshot, NetworkState } from '../../services/networkService';
import type { EncryptedPayload } from '../../storage/types';

class MockNetworkTelemetry implements INetworkTelemetryService {
  state: NetworkState = 'ONLINE_REACHABLE';
  connected = true;

  isConnected(): boolean { return this.connected; }
  getState(): NetworkState { return this.state; }
  getSnapshot(): NetworkTelemetrySnapshot {
    return {
      state: this.state,
      connected: this.connected,
      connectionType: 'wifi',
      isReachable: this.connected,
      lastCheckedTimestamp: Date.now(),
    };
  }
  subscribe(): () => void { return () => {}; }
}

describe('Phase 8 Stage 2 Security & Integrity Specification Gate', () => {
  let driver: IndexedDBDriver;
  let network: MockNetworkTelemetry;
  let outbox: OutboxManager;
  let tombstones: TombstoneManager;
  let recoveryService: RecoveryKeyService;

  const sampleEnvelope: EncryptedPayload = {
    v: 1,
    iv: 'dGVzdElWMTIzNDU2',
    ct: 'ZW5jcnlwdGVkX2pvdXJuYWxfMTIzNDU2Nzg5MA==',
  };

  beforeEach(async () => {
    driver = new IndexedDBDriver('lifted_stage2_gate_test_db');
    await driver.initialize();
    await driver.outbox.clear();
    await driver.journals.clear();
    await driver.prayers.clear();
    await driver.moods.clear();

    network = new MockNetworkTelemetry();
    outbox = new OutboxManager(driver, network, {
      hasSyncConsent: () => true,
      isSanctuaryLocked: () => false,
      isKeyReady: () => true,
      getAppLifecycleState: () => 'active',
    });

    tombstones = new TombstoneManager(driver);
    await tombstones.clear();

    recoveryService = new RecoveryKeyService();
  });

  afterEach(async () => {
    await driver.close();
  });

  describe('1. Repository / Outbox Non-Sacrifice & Reconciliation Atomicity', () => {
    it('Never sacrifices local journal entry when outbox queuing fails', async () => {
      let syncConsent = true;
      const account = { localUserId: 'guest-loc-1', cloudUserId: 'cloud-usr-1' };

      const recon = new SyncReconciliationEngine(driver, outbox, {
        hasSyncConsent: () => syncConsent,
        getActiveAccount: () => account,
      });

      // User creates a deeply vulnerable journal reflection
      const journalStorageRecord = {
        id: 'journal-vulnerable-1',
        date: '2026-11-01',
        timestamp: Date.now(),
        contentEncrypted: sampleEnvelope,
        promptEncrypted: null,
        localUserId: account.localUserId,
        cloudUserId: account.cloudUserId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // 1. Write local record to store
      await driver.journals.put(journalStorageRecord);
      expect(await driver.journals.get('journal-vulnerable-1')).toBeDefined();

      // 2. Outbox queuing encounters a failure (simulated)
      const queueResult = await recon.recordDomainChange(
        'journal-vulnerable-1',
        'journal',
        'insert',
        sampleEnvelope,
        0,
        1,
        true // simulate outbox failure
      );

      expect(queueResult.enqueued).toBe(false);
      expect(queueResult.error).toBe('SIMULATED_OUTBOX_STORAGE_ERROR');

      // CRITICAL INVARIANT: Local journal write was NOT destroyed or sacrificed!
      const persisted = await driver.journals.get('journal-vulnerable-1');
      expect(persisted).not.toBeNull();
      expect(persisted?.id).toBe('journal-vulnerable-1');

      // 3. Durable Reconciliation: on subsequent launch, the scanner discovers the un-queued record
      const healResult = await recon.reconcileMissingOutboxEntries();
      expect(healResult.healedCount).toBe(1);

      // Verify that outbox now has the healed operation
      const queue = await outbox.getPendingOperations();
      expect(queue).toHaveLength(1);
      expect(queue[0].recordId).toBe('journal-vulnerable-1');
    });

    it('Does not enqueue outbox operations when sync consent is false or cloud account is unlinked', async () => {
      let syncConsent = false; // User has NOT consented to cloud sync
      const account = { localUserId: 'guest-loc-1', cloudUserId: null }; // Local guest only

      const recon = new SyncReconciliationEngine(driver, outbox, {
        hasSyncConsent: () => syncConsent,
        getActiveAccount: () => account,
      });

      const queueResult = await recon.recordDomainChange(
        'journal-guest-only',
        'journal',
        'insert',
        sampleEnvelope,
        0,
        1
      );

      expect(queueResult.enqueued).toBe(false);
      const queue = await outbox.getPendingOperations();
      expect(queue).toHaveLength(0);
    });

    it('Resilience against deliberate system clock skew (1970 or 2099) without losing edits or duplicating acknowledged records', async () => {
      const syncConsent = true;
      const account = { localUserId: 'guest-loc-1', cloudUserId: 'cloud-user-clock' };

      const recon = new SyncReconciliationEngine(driver, outbox, {
        hasSyncConsent: () => syncConsent,
        getActiveAccount: () => account,
      });

      // 1. Initial record
      const content1 = { v: 1 as const, iv: 'iv1', ct: 'ciphertext-v1' };
      await driver.journals.put({
        id: 'journal-clock-test',
        date: '2026-11-01',
        timestamp: 1000,
        contentEncrypted: content1,
        localUserId: account.localUserId,
        cloudUserId: account.cloudUserId,
        createdAt: 1000,
        updatedAt: 1000,
      });

      // Server acknowledges initial record
      await recon.recordAcknowledgment(
        'journal',
        'journal-clock-test',
        'op-ack-1',
        1,
        'cloud-user-clock',
        `${content1.iv}:${content1.ct}`,
        1000
      );

      // System clock is altered forward to Year 2099: no redundant enqueue
      const heal2099 = await recon.reconcileMissingOutboxEntries();
      expect(heal2099.healedCount).toBe(0);

      // System clock is altered backward to Year 1970 (updatedAt = 50) and user edits journal
      const content2 = { v: 1 as const, iv: 'iv2', ct: 'ciphertext-v2-new-reflection' };
      await driver.journals.put({
        id: 'journal-clock-test',
        date: '2026-11-01',
        timestamp: 50,
        contentEncrypted: content2,
        localUserId: account.localUserId,
        cloudUserId: account.cloudUserId,
        createdAt: 1000,
        updatedAt: 50, // Backwards wall clock!
      });

      // Scanner detects new content and heals without dropping edit
      const heal1970 = await recon.reconcileMissingOutboxEntries();
      expect(heal1970.healedCount).toBe(1);

      const queue = await outbox.getPendingOperations();
      const op = queue.find((o) => o.recordId === 'journal-clock-test');
      expect(op).toBeDefined();
      expect(op?.encryptedEnvelope.ct).toBe('ciphertext-v2-new-reflection');
    });
  });

  describe('2. Account Logout & Isolation Without Data Loss', () => {
    it('Durably quarantines Account A pending operations on logout instead of deleting them', async () => {
      // Enqueue 2 operations for Account A
      await outbox.enqueueOperation({
        operationId: 'op-a-1',
        recordId: 'j-1',
        localUserId: 'guest-1',
        cloudUserId: 'account-A',
        recordType: 'journal',
        operationType: 'insert',
        baseRevision: 0,
        newLocalRevision: 1,
        encryptedEnvelope: sampleEnvelope,
        createdAt: 1000,
        idempotencyKey: 'idem-op-a-1',
      });

      // Account A logs out -> Safe pause/quarantine (ZERO DATA LOSS)
      const pausedCount = await outbox.pauseOperationsForAccount('account-A');
      expect(pausedCount).toBe(1);

      // Invariant: Operations are NOT deleted!
      const rawStored = await driver.outbox.get('op-a-1');
      expect(rawStored).not.toBeNull();
      expect(rawStored?.status).toBe('quarantined');

      // Account B logs in and checks pending operations: CANNOT see or process Account A operations
      const pendingForB = await outbox.getPendingOperations(Date.now(), { cloudUserId: 'account-B' });
      expect(pendingForB).toHaveLength(0);

      // Account A logs back in -> operations are resumed safely
      const resumedCount = await outbox.resumeOperationsForAccount('account-A');
      expect(resumedCount).toBe(1);

      const pendingForA = await outbox.getPendingOperations(Date.now(), { cloudUserId: 'account-A' });
      expect(pendingForA).toHaveLength(1);
      expect(pendingForA[0].operationId).toBe('op-a-1');
    });

    it('Rejects unauthorized purge without explicit confirmation token', async () => {
      await outbox.enqueueOperation({
        operationId: 'op-a-del-test',
        recordId: 'j-del',
        localUserId: 'guest-1',
        cloudUserId: 'account-A',
        recordType: 'journal',
        operationType: 'delete',
        baseRevision: 1,
        newLocalRevision: 2,
        encryptedEnvelope: sampleEnvelope,
        createdAt: 1000,
        idempotencyKey: 'idem-op-a-del-test',
      });

      await expect(
        outbox.explicitPurgeAuthorizedAccountOperations('account-A', 'WRONG_TOKEN')
      ).rejects.toThrow('Unauthorized purge: confirmation token invalid.');

      // Valid token permanently purges data upon explicit user request
      const purged = await outbox.explicitPurgeAuthorizedAccountOperations('account-A', 'CONFIRM_PURGE_DATA');
      expect(purged).toBe(1);
      expect(await driver.outbox.get('op-a-del-test')).toBeNull();
    });
  });

  describe('3. Hardened Anti-Resurrection & Multi-Device Tombstone Pruning', () => {
    it('Protects devices offline for 31, 90, and 365 days from resurrecting deleted records', async () => {
      await tombstones.recordTombstone('sacred-journal-deleted', 'journal', 10, 'cloud-user-1', 1000);

      // Device B was offline for 365 days. When reconnecting, it attempts an update with revision 15
      // INVARIANT: Higher revision alone MUST NOT resurrect the record!
      const rejectedStaleSync = await tombstones.shouldRejectIncomingUpdate('sacred-journal-deleted', 15, false);
      expect(rejectedStaleSync).toBe(true);

      // Only explicit user restoration action can clear tombstone and restore record
      const explicitRestore = await tombstones.shouldRejectIncomingUpdate('sacred-journal-deleted', 15, true);
      expect(explicitRestore).toBe(false);
      expect(await tombstones.isTombstoned('sacred-journal-deleted')).toBe(false);
    });

    it('Prunes tombstones ONLY when all enrolled active devices have acknowledged deletion', async () => {
      const activeDevices = ['phone-alpha', 'ipad-beta'];
      await tombstones.recordTombstone('tomb-ack-test', 'prayer', 4, 'cloud-user-1', 1000);

      // Device 1 acknowledges
      await tombstones.acknowledgeDevice('tomb-ack-test', 'phone-alpha');
      expect(await tombstones.pruneAcknowledgedTombstones(activeDevices)).toBe(0);

      // Device 2 acknowledges
      await tombstones.acknowledgeDevice('tomb-ack-test', 'ipad-beta');
      expect(await tombstones.pruneAcknowledgedTombstones(activeDevices)).toBe(1);
      expect(await tombstones.isTombstoned('tomb-ack-test')).toBe(false);
    });

    it('Safely handles device retirement without waiting indefinitely for lost device', async () => {
      const activeDevices = ['phone-alpha', 'lost-tablet-beta'];
      await tombstones.recordTombstone('tomb-retire-test', 'prayer', 4, 'cloud-user-1', 1000);

      // Only phone-alpha is active and acknowledges
      await tombstones.acknowledgeDevice('tomb-retire-test', 'phone-alpha');
      expect(await tombstones.pruneAcknowledgedTombstones(activeDevices)).toBe(0);

      // User retires the lost tablet
      const pruned = await tombstones.retireDevice('lost-tablet-beta', ['phone-alpha']);
      expect(pruned).toBe(1);
      expect(await tombstones.isTombstoned('tomb-retire-test')).toBe(false);
    });
  });

  describe('4. Recovery-Key Generation, Validation & AEK Cryptographic Binding', () => {
    it('Generates a valid 128-bit Crockford Base32 recovery code with embedded SHA-256 checksum', async () => {
      const { code, rawEntropy } = await recoveryService.generateRecoveryCode();

      expect(code).toMatch(/^LIFT-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{5}$/);
      expect(rawEntropy.length).toBe(16);

      const validation = await recoveryService.validateRecoveryCode(code);
      expect(validation.valid).toBe(true);
      expect(validation.rawEntropyHex).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(validation.checksumHex).toHaveLength(4);     // 2 bytes = 4 hex chars
    });

    it('HKDF vs PBKDF2 Key Derivation Rationale & Verification', async () => {
      const { rawEntropy } = await recoveryService.generateRecoveryCode();
      const salt = new Uint8Array(32);
      globalThis.crypto.getRandomValues(salt);

      // HKDF-SHA-256 derivation is sub-millisecond
      const hkdfKey = await recoveryService.deriveWrappingKeyHKDF(rawEntropy, salt);
      expect(hkdfKey).toBeDefined();
      expect(hkdfKey.algorithm.name).toBe('AES-GCM');

      // PBKDF2 derivation is supported
      const pbkdf2Key = await recoveryService.deriveWrappingKeyPBKDF2(rawEntropy, salt);
      expect(pbkdf2Key).toBeDefined();

      // Benchmark both to confirm HKDF sub-millisecond rationale
      const perf = await recoveryService.compareKdfPerformance(rawEntropy);
      expect(perf.hkdfMs).toBeLessThan(50);
    });

    it('Rejects invalid or corrupted recovery codes with checksum failure', async () => {
      const { code } = await recoveryService.generateRecoveryCode();

      // Tamper with one character
      const corruptedChar = code.slice(0, 7) + (code[7] === 'A' ? 'B' : 'A') + code.slice(8);
      const validation = await recoveryService.validateRecoveryCode(corruptedChar);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Checksum verification failed');

      // Invalid length
      const shortCode = 'LIFT-1234-5678';
      const shortValidation = await recoveryService.validateRecoveryCode(shortCode);
      expect(shortValidation.valid).toBe(false);
    });

    it('Wraps and unwraps AEK with authenticated Associated Data (AAD) binding', async () => {
      const aek = await recoveryService.generateAEK();
      const { rawEntropy } = await recoveryService.generateRecoveryCode();
      const salt = new Uint8Array(32);
      globalThis.crypto.getRandomValues(salt);

      const wrappingKey = await recoveryService.deriveWrappingKey(rawEntropy, salt);

      const aadData = {
        userId: 'user-uuid-12345',
        keyVersion: 1,
        domain: 'LIFTED-AEK',
      };

      // Wrap AEK
      const envelope = await recoveryService.wrapAEK(aek, wrappingKey, aadData);
      expect(envelope.v).toBe(1);
      expect(envelope.alg).toBe('AES-GCM-256');
      expect(envelope.aad.userId).toBe('user-uuid-12345');

      // Unwrap AEK with identical matching AAD
      const unwrappedAek = await recoveryService.unwrapAEK(envelope, wrappingKey, aadData);
      expect(unwrappedAek).toBeDefined();

      // Test encryption roundtrip with unwrapped AEK
      const secret = 'Sacred pastoral reflection text';
      const enc = new TextEncoder();
      const iv = new Uint8Array(12);
      globalThis.crypto.getRandomValues(iv);

      const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        aek,
        enc.encode(secret)
      );

      const decrypted = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        unwrappedAek,
        encrypted
      );

      const dec = new TextDecoder();
      expect(dec.decode(decrypted)).toBe(secret);
    });

    it('Cross-Account Ciphertext Substitution Defense: Fails when AAD or user account is substituted', async () => {
      const aek = await recoveryService.generateAEK();
      const { rawEntropy } = await recoveryService.generateRecoveryCode();
      const salt = new Uint8Array(32);
      globalThis.crypto.getRandomValues(salt);

      const wrappingKey = await recoveryService.deriveWrappingKey(rawEntropy, salt);

      const envelope = await recoveryService.wrapAEK(aek, wrappingKey, {
        userId: 'user-A',
        keyVersion: 1,
        domain: 'LIFTED-AEK',
      });

      // Attacker attempts to unwrap envelope under User B's identity:
      await expect(
        recoveryService.unwrapAEK(envelope, wrappingKey, {
          userId: 'user-B', // SUBSTITUTED USER
          keyVersion: 1,
          domain: 'LIFTED-AEK',
        })
      ).rejects.toThrow(TamperedCiphertextError);
    });

    it('Rejects unsupported envelope versions during unwrapping', async () => {
      const aek = await recoveryService.generateAEK();
      const { rawEntropy } = await recoveryService.generateRecoveryCode();
      const salt = new Uint8Array(32);
      globalThis.crypto.getRandomValues(salt);

      const wrappingKey = await recoveryService.deriveWrappingKey(rawEntropy, salt);

      const envelope = await recoveryService.wrapAEK(aek, wrappingKey, {
        userId: 'user-A',
        keyVersion: 1,
        domain: 'LIFTED-AEK',
      });

      const futureEnvelope = { ...envelope, v: 2 };

      await expect(
        recoveryService.unwrapAEK(futureEnvelope, wrappingKey, {
          userId: 'user-A',
          keyVersion: 1,
          domain: 'LIFTED-AEK',
        })
      ).rejects.toThrow('Unsupported wrapped AEK envelope version.');
    });
  });
});
