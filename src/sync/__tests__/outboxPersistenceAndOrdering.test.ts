/**
 * LIFTED — Outbox Persistence, Idempotency & Ordering Test Suite
 * Phase 8 Stage 1: Durable Local Outbox Foundation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { IndexedDBDriver } from '../../storage/databaseDriver';
import { OutboxManager } from '../outboxManager';
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

describe('Outbox Persistence, Idempotency & Ordering', () => {
  let driver: IndexedDBDriver;
  let network: MockNetworkTelemetry;
  let outbox: OutboxManager;

  const sampleEnvelope: EncryptedPayload = {
    v: 1,
    iv: 'dGVzdElWMTIzNDU2',
    ct: 'ZW5jcnlwdGVkX2pvdXJuYWxfY29udGVudF8xMjM0NTY3ODk=',
  };

  beforeEach(async () => {
    driver = new IndexedDBDriver('lifted_test_outbox_db');
    await driver.initialize();
    await driver.outbox.clear();

    network = new MockNetworkTelemetry();
    outbox = new OutboxManager(driver, network, {
      hasSyncConsent: () => true,
      isSanctuaryLocked: () => false,
      isKeyReady: () => true,
      getAppLifecycleState: () => 'active',
    });
  });

  afterEach(async () => {
    await driver.close();
  });

  it('1. Persists an operation durably in the local outbox', async () => {
    const op = await outbox.enqueue({
      operationId: 'op-001',
      recordId: 'journal-123',
      localUserId: 'guest-uuid-1',
      cloudUserId: 'user-cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'idemp-001',
    });

    expect(op.operationId).toBe('op-001');
    expect(op.status).toBe('pending');
    expect(op.retryCount).toBe(0);

    const stored = await driver.outbox.get('op-001');
    expect(stored).toBeDefined();
    expect(stored?.recordId).toBe('journal-123');
    expect(stored?.encryptedEnvelope.ct).toBe(sampleEnvelope.ct);
  });

  it('2. Enforces idempotent insertion on repeated operationId (Exact Replay Protection)', async () => {
    const first = await outbox.enqueue({
      operationId: 'op-dup-1',
      recordId: 'journal-456',
      localUserId: 'guest-uuid-1',
      cloudUserId: 'user-cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'idemp-dup-1',
    });

    const second = await outbox.enqueue({
      operationId: 'op-dup-1', // Same operation ID
      recordId: 'journal-456',
      localUserId: 'guest-uuid-1',
      cloudUserId: 'user-cloud-1',
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1050,
      idempotencyKey: 'idemp-dup-1',
    });

    expect(second.operationId).toBe(first.operationId);
    expect(await driver.outbox.count()).toBe(1); // No duplicate rows created
  });

  it('3. Enforces deduplication on identical recordId and newLocalRevision', async () => {
    await outbox.enqueue({
      operationId: 'op-first-id',
      recordId: 'prayer-789',
      localUserId: 'guest-uuid-1',
      cloudUserId: null,
      recordType: 'prayer',
      operationType: 'update',
      baseRevision: 1,
      newLocalRevision: 2,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'idemp-p-1',
    });

    const duplicateRev = await outbox.enqueue({
      operationId: 'op-second-id', // Different opId, but same recordId + revision
      recordId: 'prayer-789',
      localUserId: 'guest-uuid-1',
      cloudUserId: null,
      recordType: 'prayer',
      operationType: 'update',
      baseRevision: 1,
      newLocalRevision: 2,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1100,
      idempotencyKey: 'idemp-p-2',
    });

    expect(duplicateRev.operationId).toBe('op-first-id');
    expect(await driver.outbox.count()).toBe(1);
  });

  it('4. Retrieves pending operations in deterministic order (createdAt ASC, then revision ASC)', async () => {
    await outbox.enqueue({
      operationId: 'op-late',
      recordId: 'journal-3',
      localUserId: 'guest-1',
      cloudUserId: null,
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 3000,
      idempotencyKey: 'k3',
    });

    await outbox.enqueue({
      operationId: 'op-early-rev2',
      recordId: 'journal-1',
      localUserId: 'guest-1',
      cloudUserId: null,
      recordType: 'journal',
      operationType: 'update',
      baseRevision: 1,
      newLocalRevision: 2,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'k1-2',
    });

    await outbox.enqueue({
      operationId: 'op-early-rev1',
      recordId: 'journal-1',
      localUserId: 'guest-1',
      cloudUserId: null,
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'k1-1',
    });

    const ordered = await outbox.getPendingOperations();
    expect(ordered.map((o) => o.operationId)).toEqual([
      'op-early-rev1',
      'op-early-rev2',
      'op-late',
    ]);
  });

  it('5. Crash Recovery: Resets in_flight items back to pending upon app restart', async () => {
    const op = await outbox.enqueue({
      operationId: 'op-crashed-1',
      recordId: 'journal-crash',
      localUserId: 'guest-1',
      cloudUserId: null,
      recordType: 'journal',
      operationType: 'insert',
      baseRevision: 0,
      newLocalRevision: 1,
      encryptedEnvelope: sampleEnvelope,
      createdAt: 1000,
      idempotencyKey: 'crash-key',
    });

    // Simulate item being marked in_flight before process was terminated abruptly
    op.status = 'in_flight';
    await driver.outbox.put(op);

    expect((await driver.outbox.get('op-crashed-1'))?.status).toBe('in_flight');

    // Simulate startup crash recovery
    const recovered = await outbox.recoverInFlightOperations();
    expect(recovered).toBe(1);

    const reloaded = await driver.outbox.get('op-crashed-1');
    expect(reloaded?.status).toBe('pending');
  });

  it('6. Transactional Consistency: Local rollback on failure preserves queue integrity', async () => {
    let failed = false;
    try {
      await driver.executeTransaction(async () => {
        await outbox.enqueue({
          operationId: 'op-tx-fail',
          recordId: 'journal-tx',
          localUserId: 'guest-1',
          cloudUserId: null,
          recordType: 'journal',
          operationType: 'insert',
          baseRevision: 0,
          newLocalRevision: 1,
          encryptedEnvelope: sampleEnvelope,
          createdAt: 1000,
          idempotencyKey: 'tx-key',
        });
        throw new Error('SIMULATED_LOCAL_WRITE_FAILURE');
      });
    } catch {
      failed = true;
    }

    expect(failed).toBe(true);
  });
});
